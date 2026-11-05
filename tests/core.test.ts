import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  keepRanges,
  silenceCandidates,
  duration,
  frame,
  frameUs,
  cutToSource,
  sourceToCut,
  projectSchema,
  type Media,
  type Project,
} from "../shared/model.js";
import { fcp7, fcpxml } from "../electron/timeline.js";
import { parseFrameRate, rationalMax } from "../shared/frame-rate.js";
export const media: Media = {
  path: "/tmp/中文 & 素材.mp4",
  originalPath: "/tmp/中文 & 素材.mp4",
  name: "中文 & 素材.mp4",
  durationUs: 10e6,
  fpsNum: 30,
  fpsDen: 1,
  width: 640,
  height: 360,
  audioRate: 48000,
  audioChannels: 2,
  size: 1,
  mtimeMs: 0,
  normalized: false,
  rotation: 0,
  videoIndex: 0,
  audioIndex: 1,
};
export const project = (m = media): Project => ({
  version: 2,
  transcript: null,
  media: m,
  params: defaults,
  candidates: [],
  analyzed: true,
  analysisParams: defaults,
});
test("无静音、全静音、恢复与保护区", () => {
  assert.equal(duration(keepRanges(media, [])), 10e6);
  const cs = silenceCandidates([{ startUs: 0, endUs: 10e6 }], 10e6, 0.12);
  assert.deepEqual(keepRanges(media, cs), []);
  assert.equal(
    duration(
      keepRanges(
        media,
        cs.map((c) => ({ ...c, remove: false })),
      ),
    ),
    10e6,
  );
  const protectedCs = silenceCandidates(
    [{ startUs: 2e6, endUs: 3e6 }],
    10e6,
    0.12,
  );
  assert.equal(protectedCs[0].startUs, 2120000);
  assert.equal(protectedCs[0].endUs, 2880000);
  assert.equal(
    silenceCandidates([{ startUs: 2e6, endUs: 2100000 }], 10e6, 0.12).length,
    0,
  );
});
test("重叠区间合并，首尾静音，帧边界及双向时间映射", () => {
  const cs = [
    { id: "1", startUs: 0, endUs: 1e6, remove: true },
    { id: "2", startUs: 500000, endUs: 2e6, remove: true },
    { id: "3", startUs: 9e6, endUs: 10e6, remove: true },
  ];
  const rs = keepRanges(media, cs);
  assert.deepEqual(rs, [{ startUs: 2e6, endUs: 9e6 }]);
  assert.equal(sourceToCut(3e6, rs), 1e6);
  assert.equal(cutToSource(1e6, rs), 3e6);
  const m = { ...media, fpsNum: 30000, fpsDen: 1001 };
  for (const r of keepRanges(m, cs)) {
    assert.ok(
      Math.abs(r.startUs / frameUs(m) - Math.round(r.startUs / frameUs(m))) <
        0.001,
    );
  }
});
test("XML 区分格式，正确转义路径、帧率与音视频时长", () => {
  const p = project({ ...media, fpsNum: 30000, fpsDen: 1001 });
  p.candidates = [{ id: "1", startUs: 1e6, endUs: 2e6, remove: true }];
  const x = fcp7(p, "premiere");
  assert.match(x, /<xmeml version="5">/);
  assert.match(x, /<ntsc>TRUE/);
  assert.match(x, /中文 &amp; 素材/);
  assert.match(x, /%E4%B8%AD/);
  assert.equal((x.match(/<clipitem /g) ?? []).length, 6);
  const f = fcpxml(p);
  assert.match(f, /fcpxml version="1.9"/);
  assert.match(f, /frameDuration="1001\/30000s"/);
  assert.equal((f.match(/<asset-clip /g) ?? []).length, 2);
  assert.equal(frame(1e6, p.media), 30);
});
test("项目结构校验拒绝错误参数和空区间", () => {
  assert.ok(projectSchema.safeParse(project()).success);
  assert.ok(
    !projectSchema.safeParse({
      ...project(),
      params: { ...defaults, thresholdDb: 2 },
    }).success,
  );
  assert.ok(
    !projectSchema.safeParse({
      ...project(),
      candidates: [{ id: "x", startUs: 3, endUs: 1, remove: true }],
    }).success,
  );
});

test("帧率分子/分母超过一百万的合法素材可用于预览、保存与导出", () => {
  const m = { ...media, fpsNum: 51_234_569, fpsDen: 1_707_819 };
  const p = project(m);
  assert.ok(projectSchema.safeParse(p).success);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(p))), p);
  assert.ok(Number.isFinite(frameUs(m)));
  assert.equal(frame(1e6, m), 30);
  assert.match(fcpxml(p), /frameDuration="1707819\/51234569s"/);
  assert.match(fcp7(p, "premiere"), /<timebase>30<\/timebase>/);
  for (const [num, den] of [
    [0, 1],
    [30, 0],
    [NaN, 1],
    [Infinity, 1],
    [rationalMax + 1, 1],
    [30, 1.5],
  ]) {
    assert.equal(
      projectSchema.safeParse(project({ ...media, fpsNum: num, fpsDen: den }))
        .success,
      false,
    );
  }
});

test("帧率只做无损约分，并拒绝缺失或无效元数据", () => {
  assert.deepEqual(parseFrameRate("30000000/1001000"), {
    num: 30000,
    den: 1001,
  });
  assert.deepEqual(parseFrameRate("51234569/1707819"), {
    num: 51234569,
    den: 1707819,
  });
  for (const value of [
    undefined,
    null,
    "0/0",
    "30/0",
    "N/A",
    "30",
    "1/2/3",
    "2147483648/1",
  ])
    assert.equal(parseFrameRate(value), null);
});
