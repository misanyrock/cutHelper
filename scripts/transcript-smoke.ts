import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MediaEngine } from "../electron/media.js";
import {
  projectSchema,
  projectRanges,
  duration,
  frameUs,
} from "../shared/model.js";
const root = await mkdtemp(path.join(os.tmpdir(), "cuthelper-text-ui-"));
const model =
  process.env.CUTHELPER_TEST_MODEL ??
  path.resolve(".cache/speech-tests/ggml-tiny.bin");
const audio =
  process.env.CUTHELPER_TEST_AUDIO ?? path.resolve(".cache/speech-tests/jfk.wav");
const audioOnly = process.env.CUTHELPER_TEST_MEDIA === "audio";
const screenshot = path.join(os.tmpdir(), audioOnly ? "cuthelper-audio-subtitles.png" : "cuthelper-transcript-desktop.png");
const language = process.env.CUTHELPER_TEST_LANGUAGE === "zh" ? "zh" : "en";
const correction =
  language === "zh"
    ? "字幕已校对：请保留第一句话，删除第二句话。"
    : "字幕已校对：you can do for your country.";
await stat(model);
await stat(audio);
const media = new MediaEngine(root),
  input = path.join(root, audioOnly ? "音频字幕演示.m4a" : "文字剪辑演示.mp4");
if (audioOnly) await media.ff(["-i", audio, "-vn", "-c:a", "aac", input]);
else await media.ff([
  "-f",
  "lavfi",
  "-i",
  "color=c=0x173039:size=1280x720:rate=30",
  "-loop",
  "1",
  "-framerate",
  "30",
  "-i",
  path.resolve("public/icon.png"),
  "-i",
  audio,
  "-filter_complex",
  "[1:v]scale=192:192[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[v]",
  "-map",
  "[v]",
  "-map",
  "2:a:0",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-c:a",
  "aac",
  "-shortest",
  input,
]);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.CUTHELPER_DEV_URL;
const app = await electron.launch({
  executablePath: process.env.CUTHELPER_APP_EXECUTABLE,
  args: [
    ...(process.env.CUTHELPER_APP_EXECUTABLE ? [] : ["."]),
    "--user-data-dir=" + path.join(root, "user-data"),
  ],
  env,
});
const page = await app.firstWindow();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
async function capture(file: string) {
  const base64 = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
    )
      .toPNG()
      .toString("base64"),
  );
  await writeFile(file, Buffer.from(base64, "base64"));
}
async function openDialog(file: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
}
async function saveDialog(file: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
}
async function cleanTask() {
  await page.waitForFunction(
    () => !document.querySelector(".task-banner"),
    {},
    { timeout: 180000 },
  );
  if (await page.locator(".toast.error").count())
    throw new Error(await page.locator(".toast.error").innerText());
}
async function importAndTranscribe() {
  assert.match(await page.title(), /CutHelper/);
  await openDialog(input);
  await page.getByRole("button", { name: "导入素材", exact: true }).click();
  await page
    .getByText(path.basename(input), { exact: true })
    .first().waitFor({ timeout: 120000 });
  await openDialog(model);
  await page.getByRole("button", { name: "导入模型", exact: true }).click();
  await page
    .getByText("本地语音模型已就绪", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.getByLabel("转写语言").selectOption(language);
  await page.getByRole("button", { name: "转写文字", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".sentence").length > 1 ||
      !!document.querySelector(".toast.error"),
    {},
    { timeout: 180000 },
  );
  await cleanTask();
  const count = await page.locator(".sentence").count();
  assert.ok(count >= 2);
  assert.match(
    await page.locator(".sentence-text").first().innerText(),
    language === "zh" ? /普通话|普通話/ : /fellow Americans/i,
  );
  return count;
}
async function audioWorkflow() {
  await importAndTranscribe();
  const player = page.locator("audio");
  await page.waitForFunction(() => (document.querySelector("audio")?.readyState ?? 0) >= 2);
  assert.equal(await page.getByRole("button", { name: "删除片段", exact: true }).count(), 0);
  const first = page.locator(".sentence").first();
  await first.getByRole("button", { name: "修正段落 1" }).click();
  const start = first.getByLabel("开始（秒）");
  const corrected = Number(await start.inputValue()) + 0.25;
  await start.fill("9999");
  assert.ok(await first.getByRole("button", { name: "完成修正" }).isDisabled());
  await start.fill(String(corrected));
  await first.getByLabel("修正文字").fill(correction);
  await first.getByRole("button", { name: "完成修正" }).click();
  await first.locator(".sentence-time").click();
  await page.waitForFunction(
    (expected) => Math.abs(document.querySelector("audio")!.currentTime - expected) < 0.05,
    corrected,
  );
  await player.evaluate((element: HTMLAudioElement) => { element.muted = true; });
  await player.evaluate((element: HTMLAudioElement) => element.play());
  await page.waitForFunction((expected) => document.querySelector("audio")!.currentTime > expected + 0.2, corrected);
  await player.evaluate((element: HTMLAudioElement) => element.pause());
  const saved = path.join(root, "音频项目.cuthelper.json");
  await saveDialog(saved);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await page.getByText("项目已保存：" + saved, { exact: true }).waitFor();
  const project = projectSchema.parse(JSON.parse(await readFile(saved, "utf8")));
  assert.equal(project.media.kind, "audio");
  assert.equal(project.transcript?.segments[0].subtitleTiming?.startUs, Math.round(corrected * 1e6));
  await openDialog(saved);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await cleanTask();
  assert.match(await first.locator(".sentence-text").innerText(), /字幕已校对/);
  const output = path.join(root, "原始字幕.srt");
  await saveDialog(output);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /视频 MP4|粗剪字幕 SRT/ }).count(), 0);
  const srtButton = page.getByRole("button", { name: /原始字幕 SRT/ });
  await srtButton.waitFor();
  await capture(screenshot);
  await srtButton.click();
  await page.getByText("导出完成：" + output, { exact: true }).waitFor();
  const srt = await readFile(output, "utf8");
  assert.match(srt, /字幕已校对/);
  const ms = Math.round(corrected * 1000);
  assert.ok(srt.startsWith(`1\n00:00:${String(Math.floor(ms / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, media: "audio", screenshot }));
}
async function videoWorkflow() {
  await page.getByRole("tab", { name: "文字", exact: true }).waitFor();
  const count = await importAndTranscribe();
  await page.getByLabel("选择段落 1", { exact: true }).check();
  await page.getByRole("button", { name: "删除片段", exact: true }).click();
  assert.equal(await page.locator(".sentence-deleted").count(), 1);
  await page.getByRole("button", { name: "撤销剪辑", exact: true }).click();
  assert.equal(await page.locator(".sentence-deleted").count(), 0);
  await page.getByRole("button", { name: "删除片段", exact: true }).click();
  const lastId = String(count);
  await page
    .getByRole("button", { name: "修正段落 " + lastId, exact: true })
    .click();
  await page.getByLabel("修正文字", { exact: true }).fill(correction);
  await page.getByRole("button", { name: "完成修正", exact: true }).click();
  const projectFile = path.join(root, "文字项目.cuthelper.json");
  await saveDialog(projectFile);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await page.getByText("项目已保存：", { exact: false }).waitFor();
  const saved = projectSchema.parse(
    JSON.parse(await readFile(projectFile, "utf8")),
  );
  assert.equal(saved.version, 2);
  assert.ok(saved.media.kind !== "audio");
  assert.equal(saved.transcript!.segments[0].remove, true);
  assert.equal(saved.transcript!.segments.at(-1)!.text, correction);
  await page.getByRole("button", { name: "粗剪", exact: true }).click();
  await cleanTask();
  await page.waitForFunction(
    () => (document.querySelector("video")?.readyState ?? 0) >= 2,
  );
  const actualDuration = await page
    .locator("video")
    .evaluate((v: HTMLVideoElement) => v.duration);
  assert.ok(
    Math.abs(actualDuration * 1e6 - duration(projectRanges(saved))) <=
      frameUs(saved.media),
  );
  const srtFile = path.join(root, "粗剪.srt");
  await saveDialog(srtFile);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: /粗剪字幕 SRT/ }).click();
  await page.getByText("导出完成：" + srtFile, { exact: true }).waitFor();
  const srt = await readFile(srtFile, "utf8");
  assert.ok(srt.includes("字幕已校对"));
  assert.ok(!srt.includes(saved.transcript!.segments[0].text));
  assert.match(srt, /00:00:00,/);
  const originalSrt = path.join(root, "原始字幕.srt");
  await saveDialog(originalSrt);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: /原始字幕 SRT/ }).click();
  await page.getByText("导出完成：" + originalSrt, { exact: true }).waitFor();
  const original = await readFile(originalSrt, "utf8");
  assert.ok(original.includes(saved.transcript!.segments[0].text.slice(0, 10)));
  assert.ok(original.includes("字幕已校对"));
  const movie = path.join(root, "文字粗剪.mp4");
  await saveDialog(movie);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: /视频 MP4/ }).click();
  await page
    .getByText("导出完成：" + movie, { exact: true })
    .waitFor({ timeout: 120000 });
  assert.ok(
    Math.abs(
      (await media.probe(movie)).durationUs - duration(projectRanges(saved)),
    ) <= frameUs(saved.media),
  );
  await openDialog(projectFile);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await page.getByText("文字剪辑演示.mp4", { exact: true }).waitFor();
  await cleanTask();
  assert.equal(await page.locator(".sentence-deleted").count(), 1);
  assert.ok(
    (await page.locator(".sentence-text").last().innerText()).includes(
      "字幕已校对",
    ),
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".mode-toggle .active")?.textContent === "原片" &&
      (document.querySelector("video")?.readyState ?? 0) >= 2 &&
      document.querySelector("video")!.duration > 10,
  );
  await page.locator(".sentence-time").last().click();
  await page.waitForTimeout(300);
  assert.ok(
    await page
      .locator("video")
      .evaluate(
        (v: HTMLVideoElement) => v.seekable.length > 0 && v.seekable.end(0) > 1,
      ),
  );
  await page.waitForFunction(
    (expected) =>
      Math.abs(document.querySelector("video")!.currentTime - expected) < 0.1,
    saved.transcript!.segments.at(-1)!.startUs / 1e6,
  );
  assert.ok(
    await page
      .locator(".sentence")
      .last()
      .evaluate((el) => el.classList.contains("speaking")),
  );
  await page.getByLabel("选择段落 1", { exact: true }).check();
  await page
    .getByLabel("选择段落 " + lastId, { exact: true })
    .click({ modifiers: ["Shift"] });
  assert.equal(
    await page.locator(".sentence-top input:checked").count(),
    count,
  );
  await page.getByRole("button", { name: "恢复文字", exact: true }).click();
  assert.equal(await page.locator(".sentence-deleted").count(), 0);
  // Save and reopen a real transcript with an intentional silence cut to verify
  // that restoring text does not silently erase an independent silence edit.
  const overlap = {
    ...saved,
    candidates: [{ id: "1", startUs: 300000, endUs: 900000, remove: true }],
    transcript: {
      ...saved.transcript!,
      segments: saved.transcript!.segments.map((s) => ({
        ...s,
        remove: false,
      })),
    },
  };
  const interim = path.join(root, "interim.cuthelper.json");
  await saveDialog(interim);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await page.getByText("项目已保存：" + interim, { exact: true }).waitFor();
  await writeFile(projectFile, JSON.stringify(overlap));
  await openDialog(projectFile);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await cleanTask();
  await page.getByText("此段仍含静音剪切", { exact: true }).first().waitFor();
  await page
    .getByRole("button", { name: "恢复该处静音", exact: true })
    .first()
    .click();
  assert.equal(
    await page.getByText("此段仍含静音剪切", { exact: true }).count(),
    0,
  );
  await page.getByLabel("选择段落 1", { exact: true }).check();
  await page.getByRole("button", { name: "删除片段", exact: true }).click();
  if (await page.getByRole("button", { name: "关闭提示", exact: true }).count())
    await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.locator("video").evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await page.waitForTimeout(500);
  await page.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
  await page.waitForTimeout(200);
  await capture(screenshot);
  await page.getByRole("button", { name: "关闭导出菜单", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      segments: count,
      screenshot,
      flows: [
        "real offline transcription",
        "click-to-seek",
        "batch selection",
        "delete",
        "undo",
        "text correction",
        "preview",
        "SRT",
        "MP4",
        "save/reopen",
        "silence overlap restore",
      ],
    }),
  );
}
try {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1536, 1024),
  );
  if (audioOnly) await audioWorkflow();
  else await videoWorkflow();
} finally {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy();
    })
    .catch(() => {});
  await app.close();
  await rm(root, { recursive: true, force: true });
}
