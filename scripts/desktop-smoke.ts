import { _electron as electron, chromium } from "playwright";
import assert from "node:assert/strict";
import {
  mkdtemp,
  stat,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MediaEngine } from "../electron/media.js";
const root = await mkdtemp(path.join(os.tmpdir(), "cuthelper-desktop-"));
const engine = new MediaEngine(root),
  input = path.join(root, "中文 访谈样本.mp4");
await engine.ff([
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=1280x720:rate=30:duration=8",
  "-f",
  "lavfi",
  "-i",
  "aevalsrc=if(between(t\\,1\\,2)+between(t\\,4\\,5)+between(t\\,6\\,7)\\,0\\,0.3*sin(2*PI*440*t)):s=48000:d=8",
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
    "--user-data-dir=" + path.join(root, "app"),
  ],
  env,
});
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].setContentSize(1536, 1024),
);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.getByText("把停顿留给我们").waitFor();
  assert.match(await page.title(), /CutHelper/);
  await app.evaluate(({ dialog }, input) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [input],
    });
  }, input);
  await page.getByRole("button", { name: "导入视频", exact: true }).click();
  await page.waitForTimeout(2500);
  if (await page.locator(".toast.error").count())
    throw new Error(await page.locator(".toast.error").innerText());
  await page
    .getByText("中文 访谈样本.mp4", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "分析停顿", exact: true }).click();
  await page.getByText("共发现 3 段候选静音").waitFor({ timeout: 120000 });
  await page.getByRole("switch", { name: "删除静音 1", exact: true }).click();
  assert.equal(
    await page
      .getByRole("switch", { name: "删除静音 1", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  await page.getByRole("switch", { name: "删除静音 1", exact: true }).click();
  await page.getByRole("button", { name: "粗剪", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState! >= 2,
    {},
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () => !document.querySelector(".task-banner"),
    {},
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () => (document.querySelector("video")?.readyState ?? 0) >= 2,
  );
  assert.ok(
    await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.duration < 7),
  );
  await page.locator("video").evaluate(async (v: HTMLVideoElement) => {
    await v.play();
  });
  await page.waitForTimeout(700);
  assert.ok(
    await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.currentTime > 0),
  );
  await page.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
  const project = path.join(root, "样本.cuthelper.json");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, project);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await page.getByText("项目已保存：", { exact: false }).waitFor();
  assert.equal(
    JSON.parse(await readFile(project, "utf8")).candidates.length,
    3,
  );
  for (const [kind, label, ext] of [
    ["mp4", "视频 MP4", "mp4"],
    ["premiere", "Premiere XML", "xml"],
    ["resolve", "达芬奇 XML", "xml"],
    ["fcpxml", "Final Cut Pro FCPXML", "fcpxml"],
  ] as const) {
    const out = path.join(root, kind + "." + ext);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, out);
    await page.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(label) }).click();
    await page
      .getByText("导出完成：" + out, { exact: true })
      .waitFor({ timeout: 120000 });
    assert.ok((await stat(out)).size > 0);
    if (kind !== "mp4") {
      const xml = await readFile(out, "utf8");
      assert.equal(
        await page.evaluate(
          (x) =>
            new DOMParser()
              .parseFromString(x, "application/xml")
              .querySelector("parsererror")?.textContent ?? null,
          xml,
        ),
        null,
      );
    }
  }
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, root);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: /剪映素材包/ }).click();
  await page
    .getByText("导出完成：", { exact: false })
    .waitFor({ timeout: 120000 });
  // Reopen a saved project after source relocation using the native dialog adapter.
  const relocated = path.join(root, "重定位.mp4");
  await rename(input, relocated);
  await app.evaluate(
    ({ dialog }, files) => {
      let index = 0;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [files[index++]],
      });
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    },
    [project, relocated],
  );
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await page
    .getByText("重定位.mp4", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.waitForFunction(
    () => !document.querySelector(".task-banner"),
    {},
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "原片", exact: true }).click();
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 0.7;
  });
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    w.focus();
  });
  const captured = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
    )
      .toPNG()
      .toString("base64"),
  );
  await writeFile(
    "/private/tmp/cuthelper-desktop.png",
    Buffer.from(captured, "base64"),
  );
  await page.getByRole("button", { name: "关闭导出菜单" }).click();
  await page.getByRole("switch", { name: "删除静音 1", exact: true }).click();
  await page.getByRole("button", { name: "粗剪", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector(".task-banner"),
    {},
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () =>
      Number.isFinite(document.querySelector("video")?.duration) &&
      document.querySelector("video")!.duration > 6,
  );
  assert.ok(
    await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.duration > 6),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      title: await page.title(),
      screenshot: "/private/tmp/cuthelper-desktop.png",
      flows: [
        "import",
        "analysis",
        "restore",
        "actual playback",
        "project save",
        "all five exports",
        "relink",
        "preview invalidation",
      ],
      root,
    }),
  );
} finally {
  await page
    .evaluate(() => window.dispatchEvent(new Event("beforeunload")))
    .catch(() => {});
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
  });
  await app.close();
  await rm(root, {recursive:true, force:true});
}
