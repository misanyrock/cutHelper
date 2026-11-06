import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  writeFile,
  stat,
  mkdir,
  copyFile,
  rename,
  rm,
  open,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { defaultSpeechModel } from "../shared/speech-model.js";
import {
  transcriptSchema,
  type ModelStatus,
  type Media,
  type Transcript,
  type Progress,
} from "../shared/model.js";
import { parseWhisperOutput } from "../shared/transcript.js";
import type { MediaEngine } from "./media.js";

async function fileHash(file: string, signal?: AbortSignal) {
  const hash = createHash("sha256");
  const stream = createReadStream(file, { signal });
  for await (const buffer of stream) hash.update(buffer);
  return hash.digest("hex");
}
type ModelRecord = {
  file: string;
  hash: string;
  name: string;
  bytes: number;
  mtimeMs: number;
};
export class SpeechEngine {
  constructor(
    public root: string,
    public runtime: string,
    public media: MediaEngine,
    public report: (p: Progress) => void = () => {},
    public downloadSpec = defaultSpeechModel,
  ) {}
  private async record(): Promise<ModelRecord | null> {
    try {
      const value = JSON.parse(
        await readFile(path.join(this.root, "model.json"), "utf8"),
      ) as ModelRecord;
      if (
        !/^[a-f0-9]{64}\.bin$/.test(value.file) ||
        value.file !== value.hash + ".bin" ||
        typeof value.name !== "string"
      )
        return null;
      const info = await stat(path.join(this.root, value.file));
      if (
        info.size !== value.bytes ||
        Math.abs(info.mtimeMs - value.mtimeMs) > 2
      )
        return null;
      return value;
    } catch {
      return null;
    }
  }
  async status(): Promise<ModelStatus> {
    const model = await this.record();
    let runtimeReady = true;
    try {
      await access(this.runtime);
    } catch {
      runtimeReady = false;
    }
    return {
      ready: !!model,
      runtimeReady,
      name: model?.name ?? this.downloadSpec.name,
      bytes: model?.bytes ?? this.downloadSpec.bytes,
      hash: model?.hash ?? null,
    };
  }
  private async activate(
    file: string,
    name: string,
    expectedHash?: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const info = await stat(file);
    if (info.size < 1e6 || info.size > 4e9)
      throw new Error("请选择有效的 whisper.cpp GGML 模型（.bin）");
    const handle = await open(file, "r");
    const magic = Buffer.alloc(4);
    try {
      await handle.read(magic, 0, 4, 0);
    } finally {
      await handle.close();
    }
    if (magic.readUInt32LE() !== 0x67676d6c)
      throw new Error("模型格式不支持，请选择 whisper.cpp 的 GGML .bin 文件");
    this.report({ stage: "校验语音模型", percent: null });
    const hash = await fileHash(file, signal);
    if (expectedHash && hash !== expectedHash)
      throw new Error("模型校验失败，请重新下载");
    signal?.throwIfAborted();
    await mkdir(this.root, { recursive: true });
    const target = path.join(this.root, `${hash}.bin`),
      temporary = target + "." + randomUUID() + ".partial";
    try {
      await copyFile(file, temporary);
      signal?.throwIfAborted();
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    const targetInfo = await stat(target),
      record: ModelRecord = {
        file: path.basename(target),
        hash,
        name,
        bytes: targetInfo.size,
        mtimeMs: targetInfo.mtimeMs,
      };
    const meta = path.join(this.root, `model-${randomUUID()}.json`);
    try {
      await writeFile(meta, JSON.stringify(record));
      await rename(meta, path.join(this.root, "model.json"));
    } finally {
      await rm(meta, { force: true });
    }
    return this.status();
  }
  importModel(file: string, signal?: AbortSignal) {
    return this.activate(file, path.basename(file), undefined, signal);
  }
  async download(
    fetcher: (url: string, signal?: AbortSignal) => Promise<Response>,
    signal?: AbortSignal,
  ) {
    await mkdir(this.root, { recursive: true });
    const temporary = path.join(this.root, `download-${randomUUID()}.partial`);
    const response = await fetcher(this.downloadSpec.url, signal);
    if (!response.ok || !response.body)
      throw new Error(
        `模型下载失败（${response.status}），可重试或导入本地模型`,
      );
    const handle = await open(temporary, "wx");
    let received = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        signal?.throwIfAborted();
        received += chunk.length;
        if (received > this.downloadSpec.bytes)
          throw new Error("下载的模型大小不符");
        let offset = 0;
        while (offset < chunk.length) {
          const result = await handle.write(
            chunk,
            offset,
            chunk.length - offset,
          );
          offset += result.bytesWritten;
        }
        this.report({
          stage: "下载语音模型",
          percent: (received / this.downloadSpec.bytes) * 100,
        });
      }
      await handle.close();
      if (received !== this.downloadSpec.bytes)
        throw new Error("模型下载不完整，请重试");
      return await this.activate(
        temporary,
        this.downloadSpec.name,
        this.downloadSpec.sha256,
        signal,
      );
    } finally {
      await handle.close().catch(() => {});
      await rm(temporary, { force: true });
    }
  }
  async transcribe(
    media: Media,
    language: "auto" | "zh" | "en",
    signal?: AbortSignal,
  ): Promise<Transcript> {
    const model = await this.record();
    if (!model) throw new Error("请先下载或导入语音模型");
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          path: media.path,
          size: media.size,
          mtime: media.mtimeMs,
          duration: media.durationUs,
          audio: media.audioIndex,
          model: model.hash,
          language,
          runtime: "1.9.5",
          format: 2,
        }),
      )
      .digest("hex");
    const cache = path.join(this.root, "transcripts", cacheKey + ".json");
    try {
      const value = transcriptSchema.parse(
        JSON.parse(await readFile(cache, "utf8")),
      );
      if (value.segments.every((s) => s.endUs <= media.durationUs)) {
        this.report({ stage: "读取转写缓存", percent: 100 });
        return value;
      }
    } catch {}
    try {
      await access(this.runtime);
    } catch {
      throw new Error(
        "语音运行时缺失，请重新安装完整版应用；开发者运行 npm run speech:prepare",
      );
    }
    const work = path.join(this.root, `work-${randomUUID()}`);
    await mkdir(work, { recursive: true });
    const wav = path.join(work, "speech.wav"),
      output = path.join(work, "transcript");
    try {
      await this.media.ff(
        [
          "-i",
          media.path,
          "-map",
          `0:${media.audioIndex}`,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          "-progress",
          "pipe:2",
          wav,
        ],
        signal,
        "准备转写音频",
        media.durationUs / 1e6,
      );
      this.report({ stage: "离线转写文字", percent: 0 });
      await this.recognize(
        [
          "-m",
          path.join(this.root, model.file),
          "-f",
          wav,
          "-l",
          language,
          "-ojf",
          "-of",
          output,
          "-pp",
          "-ml",
          "80",
          "-sow",
          "-t",
          String(Math.max(1, Math.min(6, os.availableParallelism() - 1))),
        ],
        signal,
      );
      signal?.throwIfAborted();
      const segments = parseWhisperOutput(
        JSON.parse(await readFile(output + ".json", "utf8")),
        media.durationUs,
      );
      const transcript: Transcript = {
        language,
        modelHash: model.hash,
        createdAt: new Date().toISOString(),
        segments,
      };
      await mkdir(path.dirname(cache), { recursive: true });
      const temporary = cache + "." + randomUUID() + ".partial";
      try {
        await writeFile(temporary, JSON.stringify(transcript));
        signal?.throwIfAborted();
        await rename(temporary, cache);
      } finally {
        await rm(temporary, { force: true });
      }
      return transcript;
    } finally {
      await rm(work, { force: true, recursive: true });
    }
  }
  private async recognize(args: string[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.runtime, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let errors = "",
        tail = "";
      const abort = () => child.kill("SIGKILL");
      signal?.addEventListener("abort", abort, { once: true });
      const consume = (chunk: Buffer) => {
        errors = (errors + chunk.toString()).slice(-5000);
        tail += chunk.toString();
        const lines = tail.split(/[\r\n]/);
        tail = lines.pop() ?? "";
        for (const line of lines) {
          const match = /progress\s*=\s*(\d+)%/.exec(line);
          if (match)
            this.report({
              stage: "离线转写文字",
              percent: Math.min(99, Number(match[1])),
            });
        }
      };
      child.stderr.on("data", consume);
      child.stdout.on("data", consume);
      child.on("error", (error) => {
        signal?.removeEventListener("abort", abort);
        reject(new Error(`无法启动离线转写：${error.message}`));
      });
      child.on("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(new Error("任务已取消"));
        else if (code !== 0)
          reject(
            new Error(`转写失败，请检查模型或重试：${errors.slice(-1600)}`),
          );
        else resolve();
      });
    });
  }
}
