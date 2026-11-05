import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  projectSchema,
  projectRanges,
  duration,
  defaults,
  type Project,
} from "../shared/model.js";
import { parseWhisperOutput, subtitleSrt } from "../shared/transcript.js";
import { SpeechEngine } from "../electron/speech.js";
import { MediaEngine } from "../electron/media.js";
const media = {
  path: "/tmp/voice.mp4",
  originalPath: "/tmp/voice.mp4",
  name: "voice.mp4",
  durationUs: 10e6,
  fpsNum: 30,
  fpsDen: 1,
  width: 640,
  height: 360,
  audioChannels: 1,
  audioRate: 48000,
  size: 1,
  mtimeMs: 0,
  normalized: false,
  rotation: 0,
  videoIndex: 0,
  audioIndex: 1,
};
const segments = [
  {
    id: "1",
    startUs: 0,
    endUs: 2e6,
    text: "第一句。",
    originalText: "第一句。",
    remove: false,
  },
  {
    id: "2",
    startUs: 2e6,
    endUs: 4e6,
    text: "删除这句。",
    originalText: "删除这句。",
    remove: true,
  },
  {
    id: "3",
    startUs: 4e6,
    endUs: 6e6,
    text: "修正后的句子。",
    originalText: "第三句。",
    remove: false,
  },
];
const makeProject = (): Project => ({
  version: 2,
  media,
  params: defaults,
  analysisParams: defaults,
  analyzed: true,
  candidates: [{ id: "1", startUs: 1e6, endUs: 1.5e6, remove: true }],
  transcript: {
    language: "zh",
    modelHash: "test",
    createdAt: "2026-11-05",
    segments: structuredClone(segments),
  },
});
test("v1 项目无损迁移到 v2，文字与静音按并集剪辑", () => {
  const current = makeProject(),
    legacy = { ...current, version: 1 };
  delete (legacy as Partial<typeof legacy>).transcript;
  const migrated = projectSchema.parse(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.transcript, null);
  assert.deepEqual(migrated.candidates, current.candidates);
  assert.equal(duration(projectRanges(current)), 7.5e6);
  current.candidates.push({
    id: "2",
    startUs: 3e6,
    endUs: 4.5e6,
    remove: true,
  });
  assert.equal(duration(projectRanges(current)), 7e6);
  current.transcript!.segments[1].remove = false;
  assert.equal(duration(projectRanges(current)), 8e6);
  assert.equal(
    projectSchema.parse(JSON.parse(JSON.stringify(current))).transcript!
      .segments[2].text,
    "修正后的句子。",
  );
});
test("SRT 使用粗剪时间，跳过删除句，保留修正文本且不会产生空字幕", () => {
  const p = makeProject(),
    srt = subtitleSrt(p);
  assert.match(srt, /00:00:00,000 --> 00:00:01,500\n第一句。/);
  assert.match(srt, /00:00:01,500 --> 00:00:03,500\n修正后的句子。/);
  assert.ok(!srt.includes("删除这句"));
  assert.ok(!srt.includes("第三句。"));
  p.transcript!.segments = p.transcript!.segments.map((s) => ({
    ...s,
    remove: true,
  }));
  assert.throws(() => subtitleSrt(p), /没有可导出/);
});
test("Whisper 时间戳毫秒转微秒，裁切尾部、去除空段和噪声标记", () => {
  const result = parseWhisperOutput(
    {
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: " Hello " },
        { offsets: { from: 900, to: 2000 }, text: "world" },
        { offsets: { from: 2000, to: 3000 }, text: "[Music]" },
        { offsets: { from: 8000, to: 12000 }, text: "尾句" },
      ],
    },
    10e6,
  );
  assert.equal(result.length, 3);
  assert.equal(result[1].startUs, 1e6);
  assert.equal(result[2].endUs, 10e6);
  assert.equal(result[0].originalText, "Hello");
  assert.throws(() => parseWhisperOutput({ transcription: [] }, 1e6), /未识别/);
  assert.throws(
    () =>
      parseWhisperOutput(
        { transcription: [{ offsets: { from: "bad", to: 4 }, text: "x" }] },
        1e6,
      ),
    /时间戳/,
  );
});
test("语音模型导入、下载校验、取消和失败保持原模型", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuthelper-model-test-"));
  try {
    const data = Buffer.alloc(1024 * 1024);
    data.writeUInt32LE(0x67676d6c);
    const hash = createHash("sha256").update(data).digest("hex");
    const file = path.join(root, "local.bin");
    await writeFile(file, data);
    const engine = new SpeechEngine(
      path.join(root, "models"),
      process.execPath,
      new MediaEngine(root),
      () => {},
      {
        name: "Test",
        bytes: data.length,
        sha256: hash,
        url: "https://example.com/model",
      },
    );
    assert.equal((await engine.status()).ready, false);
    assert.equal((await engine.importModel(file)).hash, hash);
    assert.equal(
      (await engine.download(async () => new Response(data))).hash,
      hash,
    );
    const wrong = Buffer.from(data);
    wrong[100] = 1;
    await assert.rejects(
      engine.download(async () => new Response(wrong)),
      /校验/,
    );
    assert.equal((await engine.status()).hash, hash);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(engine.importModel(file, abort.signal));
    assert.equal((await engine.status()).hash, hash);
    await writeFile(path.join(root, "invalid.bin"), Buffer.alloc(1024 * 1024));
    await assert.rejects(
      engine.importModel(path.join(root, "invalid.bin")),
      /格式不支持/,
    );
    await assert.rejects(
      engine.download(async () => new Response("partial")),
      /不完整/,
    );
    assert.equal((await engine.status()).hash, hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
