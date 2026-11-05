import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, stat, rm, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseFrameRate } from "../shared/frame-rate.js";
import {
  defaults,
  silenceCandidates,
  keepRanges,
  frame,
  totalFrames,
  duration,
  type Media,
  type Params,
  type Progress,
  type Project,
  type Range,
} from "../shared/model.js";
const require = createRequire(import.meta.url);
export function binaries(resources?: string) {
  return resources
    ? {
        ffmpeg: path.join(
          resources,
          "ffmpeg" + (process.platform === "win32" ? ".exe" : ""),
        ),
        ffprobe: path.join(
          resources,
          "ffprobe" + (process.platform === "win32" ? ".exe" : ""),
        ),
      }
    : {
        ffmpeg: require("ffmpeg-static") as string,
        ffprobe: require("@ffprobe-installer/ffprobe").path as string,
      };
}
export class MediaEngine {
  private filterFileOption: string | undefined;
  constructor(
    public root: string,
    public bins = binaries(),
    public report: (p: Progress) => void = () => {},
  ) {}
  async run(
    exe: string,
    args: string[],
    signal?: AbortSignal,
    stage = "处理中",
    seconds = 0,
    onData?: (b: Buffer) => void,
  ): Promise<string> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        errors = "",
        tail = "";
      const abort = () => {
        child.kill("SIGKILL");
      };
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (b: Buffer) => {
        if (onData) onData(b);
        else {
          output += b.toString();
          if (output.length > 32e6) {
            child.kill();
            reject(new Error("媒体信息过大"));
          }
        }
      });
      child.stderr.on("data", (b: Buffer) => {
        errors = (errors + b.toString()).slice(-6000);
        tail += b.toString();
        const lines = tail.split(/\r?\n/);
        tail = lines.pop() ?? "";
        for (const line of lines) {
          const match = /^out_time_us=(\d+)/.exec(line);
          if (match && seconds)
            this.report({
              stage,
              percent: Math.min(99, (Number(match[1]) / 1e6 / seconds) * 100),
            });
        }
      });
      child.on("error", reject);
      child.on("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(new Error("任务已取消"));
        else if (code !== 0)
          reject(new Error(`媒体处理失败：${errors.slice(-1800)}`));
        else resolve(output || errors);
      });
    });
  }
  async ff(
    args: string[],
    signal?: AbortSignal,
    stage = "处理中",
    seconds = 0,
    onData?: (b: Buffer) => void,
  ) {
    return this.run(
      this.bins.ffmpeg,
      ["-hide_banner", "-nostdin", ...args],
      signal,
      stage,
      seconds,
      onData,
    );
  }
  async probe(file: string, signal?: AbortSignal): Promise<Media> {
    const info = JSON.parse(
      await this.run(
        this.bins.ffprobe,
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        signal,
      ),
    );
    const v = info.streams.find(
        (s: any) => s.codec_type === "video" && !s.disposition?.attached_pic,
      ),
      a = info.streams.find((s: any) => s.codec_type === "audio");
    if (!v) throw new Error("未找到视频轨");
    if (!a) throw new Error("视频没有音轨，无法分析口播停顿");
    if (["smpte2084", "arib-std-b67"].includes(v.color_transfer))
      throw new Error("首版暂不支持 HDR，请先转换为 SDR 视频");
    const fps =
      parseFrameRate(v.avg_frame_rate) ?? parseFrameRate(v.r_frame_rate);
    const d = Number(info.format.duration ?? v.duration);
    if (!Number.isFinite(d) || d <= 0 || !fps)
      throw new Error("视频时长或帧率无效");
    const s = await stat(file);
    return {
      path: file,
      originalPath: file,
      name: path.basename(file),
      durationUs: Math.round(d * 1e6),
      fpsNum: fps.num,
      fpsDen: fps.den,
      width: v.width,
      height: v.height,
      audioChannels: Math.min(2, a.channels),
      audioRate: Number(a.sample_rate),
      size: s.size,
      mtimeMs: s.mtimeMs,
      normalized: false,
      rotation: Number(
        v.side_data_list?.find((d: any) => d.rotation !== undefined)
          ?.rotation ??
          v.tags?.rotate ??
          0,
      ),
      videoIndex: v.index,
      audioIndex: a.index,
    };
  }
  async import(file: string, signal?: AbortSignal) {
    if (![".mp4", ".mov", ".mkv"].includes(path.extname(file).toLowerCase()))
      throw new Error("请选择 MP4、MOV 或 MKV 视频");
    await mkdir(this.root, { recursive: true });
    let media = await this.probe(file, signal);
    let variable = false;
    await this.ff(
      [
        "-i",
        file,
        "-map",
        `0:${media.videoIndex}`,
        "-vf",
        "vfrdet",
        "-an",
        "-progress",
        "pipe:2",
        "-f",
        "null",
        "-",
      ],
      signal,
      "检查帧率",
      media.durationUs / 1e6,
      (b) => void b,
    ).then((log) => {
      const ratio = /VFR:([\d.]+)/.exec(log);
      variable = Number(ratio?.[1] ?? 0) > 0.001;
    });
    if (variable || media.rotation % 360 !== 0) {
      const target = path.join(this.root, `${randomUUID()}-cfr.mp4`);
      try {
        await this.ff(
          [
            "-i",
            file,
            "-map",
            `0:${media.videoIndex}`,
            "-map",
            `0:${media.audioIndex}`,
            "-vf",
            variable ? "fps=30" : `fps=${media.fpsNum}/${media.fpsDen}`,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            String(media.audioChannels),
            "-progress",
            "pipe:2",
            target,
          ],
          signal,
          "转换恒定帧率",
          media.durationUs / 1e6,
        );
        const normalized = await this.probe(target, signal);
        media = {
          ...normalized,
          originalPath: file,
          name: media.name,
          normalized: true,
        };
      } catch (e) {
        await rm(target, { force: true });
        throw e;
      }
    }
    return media;
  }
  async waveform(m: Media, signal?: AbortSignal) {
    const bins = new Array<number>(
      Math.min(12000, Math.max(200, Math.ceil((m.durationUs / 1e6) * 30))),
    ).fill(0);
    let sample = 0,
      carry: Buffer = Buffer.alloc(0);
    const count = Math.ceil((m.durationUs / 1e6) * 8000);
    await this.ff(
      [
        "-i",
        m.path,
        "-map",
        `0:${m.audioIndex}`,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-progress",
        "pipe:2",
        "-f",
        "s16le",
        "pipe:1",
      ],
      signal,
      "读取波形",
      m.durationUs / 1e6,
      (b) => {
        const chunk = Buffer.concat([carry, b]);
        let i = 0;
        for (; i + 1 < chunk.length; i += 2) {
          const idx = Math.min(
            bins.length - 1,
            Math.floor((sample++ / count) * bins.length),
          );
          bins[idx] = Math.max(
            bins[idx],
            Math.abs(chunk.readInt16LE(i)) / 32768,
          );
        }
        carry = chunk.subarray(i);
      },
    );
    return bins;
  }
  async analyze(m: Media, p: Params, signal?: AbortSignal) {
    const silences: Range[] = [];
    let start: number | null = null,
      tail = "";
    // Metadata is streamed to stdout; progress stays separate on stderr.
    await this.ff(
      [
        "-i",
        m.path,
        "-map",
        `0:${m.audioIndex}`,
        "-vn",
        "-af",
        `silencedetect=noise=${p.thresholdDb}dB:d=${p.minSilence},ametadata=mode=print:file=-`,
        "-progress",
        "pipe:2",
        "-f",
        "null",
        "-",
      ],
      signal,
      "分析停顿",
      m.durationUs / 1e6,
      (b) => {
        tail += b.toString();
        const lines = tail.split("\n");
        tail = lines.pop() ?? "";
        for (const line of lines) {
          const a = /lavfi.silence_start=([\d.]+)/.exec(line),
            z = /lavfi.silence_end=([\d.]+)/.exec(line);
          if (a) start = Math.round(Number(a[1]) * 1e6);
          if (z && start !== null) {
            silences.push({
              startUs: start,
              endUs: Math.min(m.durationUs, Math.round(Number(z[1]) * 1e6)),
            });
            start = null;
          }
        }
      },
    );
    if (start !== null) silences.push({ startUs: start, endUs: m.durationUs });
    return silenceCandidates(silences, m.durationUs, p.padding);
  }
  async render(
    m: Media,
    rs: Range[],
    destination: string,
    signal?: AbortSignal,
    preview = false,
  ) {
    if (!rs.length) throw new Error("没有保留片段，请先恢复至少一段");
    const graph =
      rs
        .flatMap((r, i) => {
          const a = frame(r.startUs, m),
            b = frame(r.endUs, m),
            start = (a * m.fpsDen) / m.fpsNum,
            end = (b * m.fpsDen) / m.fpsNum;
          return [
            `[0:${m.videoIndex}]trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS${preview ? ",scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2" : ""}[v${i}]`,
            `[0:${m.audioIndex}]atrim=start=${start.toFixed(9)}:end=${end.toFixed(9)},asetpts=PTS-STARTPTS[a${i}]`,
          ];
        })
        .join(";") +
      ";" +
      rs.map((_, i) => `[v${i}][a${i}]`).join("") +
      `concat=n=${rs.length}:v=1:a=1[v][a]`;
    const script = path.join(this.root, `${randomUUID()}.txt`);
    await writeFile(script, graph);
    if (!this.filterFileOption) {
      const version = await this.run(this.bins.ffmpeg, ["-version"], signal);
      this.filterFileOption =
        Number(/ffmpeg version (\d+)/.exec(version)?.[1] ?? 6) >= 7
          ? "-/filter_complex"
          : "-filter_complex_script";
    }
    try {
      await this.ff(
        [
          "-i",
          m.path,
          this.filterFileOption,
          script,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-c:v",
          "libx264",
          "-preset",
          preview ? "ultrafast" : "fast",
          "-crf",
          preview ? "25" : "18",
          "-pix_fmt",
          "yuv420p",
          "-r",
          `${m.fpsNum}/${m.fpsDen}`,
          "-fps_mode",
          "cfr",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          String(m.audioChannels),
          "-movflags",
          "+faststart",
          "-progress",
          "pipe:2",
          "-f",
          "mp4",
          destination,
        ],
        signal,
        preview ? "生成预览" : "导出视频",
        duration(rs) / 1e6,
      );
    } catch (e) {
      await rm(destination, { force: true });
      throw e;
    } finally {
      await rm(script, { force: true });
    }
  }
  async sourcePreview(m: Media, signal?: AbortSignal) {
    const out = path.join(this.root, `${randomUUID()}-preview.mp4`);
    await this.render(
      m,
      [
        {
          startUs: 0,
          endUs: Math.round((totalFrames(m) * 1e6 * m.fpsDen) / m.fpsNum),
        },
      ],
      out,
      signal,
      true,
    );
    return out;
  }
}
