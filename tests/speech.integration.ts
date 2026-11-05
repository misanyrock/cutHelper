// Opt-in real-model test. CI prepares a tiny model; local validation can use small.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MediaEngine } from "../electron/media.js";
import { SpeechEngine } from "../electron/speech.js";
import { subtitleSrt } from "../shared/transcript.js";
import { projectSchema, projectRanges, duration } from "../shared/model.js";
test("真实离线模型：转写、缓存、删句与字幕导出", async () => {
  const model =
    process.env.CUTHELPER_TEST_MODEL ??
    path.resolve(".cache/speech-tests/ggml-tiny.bin");
  const sample =
    process.env.CUTHELPER_TEST_AUDIO ??
    path.resolve(".cache/speech-tests/jfk.wav");
  await stat(model);
  await stat(sample);
  const root = await mkdtemp(path.join(os.tmpdir(), "cuthelper-real-speech-"));
  try {
    const media = new MediaEngine(root),
      video = path.join(root, "speech.mp4");
    await media.ff([
      "-f",
      "lavfi",
      "-i",
      "color=c=0x173039:size=320x180:rate=30",
      "-i",
      sample,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-shortest",
      video,
    ]);
    const info = await media.probe(video),
      runtime = path.resolve(
        `.cache/whisper-runtime/${process.platform}-${process.arch}/whisper-cli${process.platform === "win32" ? ".exe" : ""}`,
      ),
      engine = new SpeechEngine(
        path.join(root, "中文模型与缓存"),
        runtime,
        media,
      );
    await engine.importModel(model);
    const result = await engine.transcribe(info, "en");
    assert.match(
      result.segments.map((s) => s.text).join(" "),
      /fellow Americans/i,
    );
    assert.ok(
      result.segments.every(
        (s) => s.startUs >= 0 && s.endUs <= info.durationUs,
      ),
    );
    const cached = await engine.transcribe(info, "en");
    assert.deepEqual(cached, result);
    const aborted = new AbortController();
    engine.report = (p) => {
      if (p.stage === "离线转写文字") setTimeout(() => aborted.abort(), 100);
    };
    await assert.rejects(
      engine.transcribe(info, "auto", aborted.signal),
      /取消|abort/i,
    );
    engine.report = () => {};
    assert.deepEqual(await engine.transcribe(info, "en"), result);

    const p = projectSchema.parse({
      version: 2,
      media: info,
      params: { thresholdDb: -35, minSilence: 0.6, padding: 0.12 },
      candidates: [],
      analyzed: false,
      transcript: result,
    });
    assert.ok(subtitleSrt(p).includes("-->"));
    p.transcript!.segments[0].remove = true;
    const rs = projectRanges(p);
    assert.ok(duration(rs) < info.durationUs);
    const out = path.join(root, "edited.mp4");
    await media.render(info, rs, out);
    assert.ok((await stat(out)).size > 0);
    assert.ok(!subtitleSrt(p).includes(result.segments[0].text));
    console.log(
      "Real offline transcript:",
      result.segments.map((s) => ({
        startUs: s.startUs,
        endUs: s.endUs,
        text: s.text,
      })),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
