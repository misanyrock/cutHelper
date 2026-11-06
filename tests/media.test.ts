import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MediaEngine } from "../electron/media.js";
import {
  defaults,
  keepRanges,
  duration,
  frameUs,
  projectSchema,
} from "../shared/model.js";
test("MP3、WAV 和 M4A 可在中文路径导入并生成音频试听文件", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuthelper-audio-"));
  const engine = new MediaEngine(root);
  try {
    for (const ext of ["mp3", "wav", "m4a"]) {
      const file = path.join(root, `字幕 素材.${ext}`);
      await engine.ff(["-f", "lavfi", "-i", "sine=duration=1", file]);
      const media = await engine.importMedia(file);
      assert.equal(media.kind, "audio");
      assert.ok(Math.abs(media.durationUs - 1e6) < 100_000);
      assert.ok((await engine.waveform(media)).some((v) => v > 0));
      const preview = await engine.sourcePreview(media);
      assert.equal(path.extname(preview), ".m4a");
      const decoded = await engine.importMedia(preview);
      assert.ok(Math.abs(decoded.durationUs - media.durationUs) < 100_000);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("真实 FFmpeg：中文路径导入、静音检测、音画同步导出、29.97 fps、VFR、取消与失败清理", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuthelper-test-"));
  const engine = new MediaEngine(
    root,
    process.env.CUTHELPER_TEST_MEDIA_DIR
      ? {
          ffmpeg: path.join(process.env.CUTHELPER_TEST_MEDIA_DIR, "ffmpeg"),
          ffprobe: path.join(process.env.CUTHELPER_TEST_MEDIA_DIR, "ffprobe"),
        }
      : undefined,
  );
  let file = path.join(root, "中文 素材.mp4");
  try {
    await engine.ff([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=6",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(between(t\\,1\\,2)+between(t\\,4\\,5)\\,0\\,0.4*sin(2*PI*440*t)):s=48000:d=6",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
    const m = await engine.import(file);
    assert.equal(m.normalized, false);
    assert.equal(m.fpsNum / m.fpsDen, 30);
    const waveform = await engine.waveform(m);
    assert.ok(Math.max(...waveform) > 0.1);
    const cs = await engine.analyze(m, defaults);
    assert.equal(cs.length, 2);
    assert.ok(Math.abs(cs[0].startUs - 1120000) < 50000);
    const rs = keepRanges(m, cs),
      out = path.join(root, "导出.mp4");
    await engine.render(m, rs, out);
    const result = await engine.probe(out);
    assert.ok(Math.abs(result.durationUs - duration(rs)) <= frameUs(m));
    const streams = JSON.parse(
      await engine.run(engine.bins.ffprobe, [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        out,
      ]),
    ).streams;
    assert.ok(
      Math.abs(Number(streams[0].duration) - Number(streams[1].duration)) <=
        frameUs(m) / 1e6,
    );
    await t.test("大分子帧率经过项目校验后可真实生成粗剪预览", async () => {
      const metadata = JSON.parse(
        await engine.run(engine.bins.ffprobe, [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          file,
        ]),
      );
      metadata.streams.find(
        (s: any) => s.codec_type === "video",
      ).avg_frame_rate = "51234569/1707819";
      const probeEngine = new MediaEngine(root, engine.bins);
      probeEngine.run = async () => JSON.stringify(metadata);
      const high = await probeEngine.probe(file);
      const p = projectSchema.parse({
        version: 1,
        media: high,
        params: defaults,
        candidates: cs,
        analyzed: true,
        analysisParams: defaults,
      });
      assert.ok(p.media.kind !== "audio");
      assert.equal(p.media.fpsNum, 51234569);
      const retained = keepRanges(high, cs),
        target = path.join(root, "large-fps-preview.mp4");
      await engine.render(high, retained, target, undefined, true);
      const rendered = await engine.probe(target);
      assert.ok(
        Math.abs(rendered.durationUs - duration(retained)) <= frameUs(high),
      );
      metadata.streams.find(
        (s: any) => s.codec_type === "video",
      ).avg_frame_rate = "0/0";
      metadata.streams.find((s: any) => s.codec_type === "video").r_frame_rate =
        "30000/1001";
      assert.equal((await probeEngine.probe(file)).fpsNum, 30000);
    });
    await t.test("全静音及无静音", async () => {
      for (const silent of [true, false]) {
        const dest = path.join(root, `silent-${silent}.mp4`);
        await engine.ff([
          "-f",
          "lavfi",
          "-i",
          "color=size=160x90:rate=30:duration=1",
          "-f",
          "lavfi",
          "-i",
          silent
            ? "anullsrc=r=48000:cl=mono"
            : "sine=frequency=440:sample_rate=48000:duration=1",
          "-t",
          "1",
          "-c:v",
          "libx264",
          "-c:a",
          "aac",
          dest,
        ]);
        const mm = await engine.probe(dest),
          cc = await engine.analyze(mm, defaults);
        assert.equal(cc.length, silent ? 1 : 0);
        if (silent) assert.equal(keepRanges(mm, cc).length, 0);
      }
    });
    await t.test("首尾静音", async () => {
      const dest = path.join(root, "edges.mp4");
      await engine.ff([
        "-f",
        "lavfi",
        "-i",
        "color=size=160x90:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=if(between(t\\,1\\,2)\\,0.4*sin(2*PI*440*t)\\,0):s=48000:d=3",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        dest,
      ]);
      const mm = await engine.probe(dest),
        cc = await engine.analyze(mm, defaults);
      assert.equal(cc.length, 2);
      assert.equal(cc[0].startUs, 0);
      assert.equal(cc[1].endUs, mm.durationUs);
    });
    await t.test("29.97 fps", async () => {
      const dest = path.join(root, "ntsc.mp4");
      await engine.ff([
        "-i",
        file,
        "-r",
        "30000/1001",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        dest,
      ]);
      const mm = await engine.import(dest);
      assert.equal(mm.fpsNum, 30000);
      assert.equal(mm.fpsDen, 1001);
      const r = keepRanges(mm, await engine.analyze(mm, defaults)),
        o = path.join(root, "ntsc-cut.mp4");
      await engine.render(mm, r, o);
      assert.ok(
        Math.abs((await engine.probe(o)).durationUs - duration(r)) <=
          frameUs(mm),
      );
    });
    await t.test("可变帧率转换", async () => {
      const dest = path.join(root, "vfr.mkv");
      await engine.ff([
        "-i",
        file,
        "-vf",
        "select='if(lt(t,3),1,not(mod(n,2)))'",
        "-fps_mode",
        "vfr",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        dest,
      ]);
      const mm = await engine.import(dest);
      assert.equal(mm.normalized, true);
      assert.equal(mm.fpsNum / mm.fpsDen, 30);
      assert.equal(mm.originalPath, dest);
    });
    await t.test("手机竖屏旋转信息规范化", async () => {
      const dest = path.join(root, "rotated.mp4");
      // Set input display rotation explicitly: writing a rotate metadata tag
      // is ignored by some of the platform-specific FFmpeg builds.
      await engine.ff([
        "-display_rotation:v:0",
        "90",
        "-i",
        file,
        "-c",
        "copy",
        dest,
      ]);
      assert.equal(
        Math.abs((await engine.probe(dest)).rotation),
        90,
        "The test fixture must contain a 90-degree display rotation",
      );
      const mm = await engine.import(dest);
      assert.equal(mm.normalized, true);
      assert.equal(mm.width, 180);
      assert.equal(mm.height, 320);
    });
    await t.test("取消与失败不遗留输出", async () => {
      const abort = new AbortController();
      const o = path.join(root, "cancel.mp4");
      const render = engine.render(m, rs, o, abort.signal);
      abort.abort();
      await assert.rejects(render);
      await assert.rejects(stat(o));
      await assert.rejects(engine.render(m, [], o), /没有保留/);
      const bad = path.join(root, "not-existing", "bad.mp4");
      await assert.rejects(engine.render(m, rs, bad));
      await assert.rejects(stat(bad));
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
