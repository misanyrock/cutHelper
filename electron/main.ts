import { app, BrowserWindow, dialog, ipcMain, protocol, net } from "electron";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  stat,
  readFile,
  writeFile,
  rename,
  rm,
  copyFile,
} from "node:fs/promises";
import { MediaEngine, binaries, videoExtensions, audioExtensions } from "./media.js";
import { fcp7, fcpxml } from "./timeline.js";
import { SpeechEngine } from "./speech.js";
import {serveMediaFile} from "./media-protocol.js";
import { subtitleSrt } from "../shared/transcript.js";
import {
  defaults,
  mediaSchema,
  frameUs,
  paramsSchema,
  projectSchema,
  projectRanges,
  type Media,
  type Project,
  type ExportKind,
} from "../shared/model.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const userDataOverride = app.commandLine.getSwitchValue("user-data-dir");
if (userDataOverride && path.isAbsolute(userDataOverride)) {
  mkdirSync(userDataOverride, { recursive: true });
  app.setPath("userData", userDataOverride);
}
let win: BrowserWindow,
  engine: MediaEngine,
  active: Media | null = null,
  controller: AbortController | null = null;
let tempPreviews: string[] = [];
const urls = new Map<string, string>();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "cutmedia",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);
function mediaUrl(file: string) {
  const id = randomUUID();
  urls.set(id, file);
  return `cutmedia://local/${id}`;
}
async function task<T>(stage: string, fn: (s: AbortSignal) => Promise<T>) {
  if (controller) throw new Error("请等待当前任务完成，或先取消");
  controller = new AbortController();
  win.webContents.send("progress", { stage, percent: null });
  try {
    const r = await fn(controller.signal);
    win.webContents.send("progress", { stage: "完成", percent: 100 });
    return r;
  } catch (e) {
    win.webContents.send("progress", { stage: "已停止", percent: null });
    throw controller?.signal.aborted ? new Error("任务已取消") : e;
  } finally {
    controller = null;
  }
}
function checked(raw: unknown): Project {
  const p = projectSchema.parse(raw);
  if (!active || JSON.stringify(p.media) !== JSON.stringify(mediaSchema.parse(active)))
    throw new Error("素材状态已变化，请重新打开项目");
  if (
    p.candidates.some((c) => c.endUs > p.media.durationUs) ||
    p.transcript?.segments.some((s) => s.endUs > p.media.durationUs)
  )
    throw new Error("剪辑区间超出素材");
  return p;
}
async function loaded(media: Media, signal: AbortSignal, project?: Project) {
  const waveform = await engine.waveform(media, signal);
  const preview = await engine.sourcePreview(media, signal);
  tempPreviews.push(preview);
  active = media;
  return {
    project: project ?? {
      version: 2,
      transcript: null,
      media,
      params: defaults,
      candidates: [],
      analyzed: false,
      analysisParams: null,
    },
    waveform,
    sourceUrl: mediaUrl(preview),
  };
}
async function importFile(file: string, signal: AbortSignal) {
  const media = await engine.importMedia(file, signal);
  return loaded(media, signal);
}
async function pickMedia() {
  const r = await dialog.showOpenDialog(win, {
    title: "导入视频或音频",
    properties: ["openFile"],
    filters: [{ name: "视频和音频", extensions: [...videoExtensions, ...audioExtensions] }],
  });
  return r.canceled ? null : r.filePaths[0];
}
async function atomicFile(
  target: string,
  fn: (temporary: string) => Promise<void>,
) {
  if (
    active &&
    [active.path, active.originalPath].some(
      (p) => path.resolve(p) === path.resolve(target),
    )
  )
    throw new Error("不能覆盖原素材");
  const temp = path.join(
    path.dirname(target),
    `.cuthelper-${randomUUID()}${path.extname(target)}`,
  );
  try {
    await fn(temp);
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}
app.whenReady().then(async () => {
  const root = path.join(app.getPath("userData"), "media");
  await mkdir(root, { recursive: true });
  engine = new MediaEngine(
    root,
    binaries(
      app.isPackaged ? path.join(process.resourcesPath, "media") : undefined,
    ),
    (p) => win?.webContents.send("progress", p),
  );
  protocol.handle("cutmedia", (request) => {
    const url = new URL(request.url),
      file = urls.get(url.pathname.slice(1));
    if (url.hostname !== "local" || !file)
      return new Response("Not found", { status: 404 });
    return serveMediaFile(file,request);
  });
  const applicationIcon = path.join(here, "../../dist/icon.png");
  if (process.platform === "darwin") app.dock?.setIcon(applicationIcon);
  win = new BrowserWindow({
    icon: applicationIcon,
    width: 1536,
    height: 1024,
    minWidth: 1000,
    minHeight: 720,
    title: "CutHelper",
    backgroundColor: "#f6f8fb",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["继续编辑", "丢弃并退出"],
      defaultId: 0,
      cancelId: 0,
      message: "有未保存的修改，确定退出？",
    });
    if (choice === 1) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("无效请求");
  };
  const handle = (name: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(name, (e, ...args) => {
      trusted(e);
      return fn(...args);
    });
  handle("import", async () => {
    const file = await pickMedia();
    return file ? task("导入素材", (s) => importFile(file, s)) : null;
  });
  handle("drop", (file: unknown) => {
    if (typeof file !== "string" || !path.isAbsolute(file))
      throw new Error("无效素材路径");
    return task("导入素材", (s) => importFile(file, s));
  });
  const speech = new SpeechEngine(
    path.join(app.getPath("userData"), "speech"),
    app.isPackaged
      ? path.join(
          process.resourcesPath,
          "media",
          "whisper-cli" + (process.platform === "win32" ? ".exe" : ""),
        )
      : path.resolve(
          ".cache/whisper-runtime",
          `${process.platform}-${process.arch}`,
          "whisper-cli" + (process.platform === "win32" ? ".exe" : ""),
        ),
    engine,
    (p) => win.webContents.send("progress", p),
  );
  handle("model-status", () => speech.status());
  handle("model-download", () =>
    task("下载语音模型", (signal) =>
      speech.download((url, s) => net.fetch(url, { signal: s }), signal),
    ),
  );
  handle("model-import", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "导入 whisper.cpp 语音模型",
      filters: [{ name: "GGML 模型", extensions: ["bin"] }],
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    return task("导入语音模型", (signal) =>
      speech.importModel(result.filePaths[0], signal),
    );
  });
  handle("transcribe", (language: unknown) => {
    if (!active) throw new Error("请先导入视频或音频");
    if (!["auto", "zh", "en"].includes(String(language)))
      throw new Error("不支持的转写语言");
    return task("转写文字", (signal) =>
      speech.transcribe(active!, language as "auto" | "zh" | "en", signal),
    );
  });
  handle("analyze", (raw: unknown) => {
    const p = paramsSchema.parse(raw);
    const media = active;
    if (!media || media.kind === "audio") throw new Error("请先导入视频");
    return task("分析停顿", (s) => engine.analyze(media, p, s));
  });
  handle("preview", (raw: unknown) => {
    const p = checked(raw);
    const media = p.media;
    if (media.kind === "audio") throw new Error("纯音频项目仅支持原音试听");
    return task("生成预览", async (s) => {
      const file = path.join(root, `${randomUUID()}-cut.mp4`);
      await engine.render(media, projectRanges(p), file, s, true);
      tempPreviews.push(file);
      return mediaUrl(file);
    });
  });
  handle("save", async (raw: unknown) => {
    const p = checked(raw);
    const r = await dialog.showSaveDialog(win, {
      defaultPath: p.media.name + ".cuthelper.json",
      filters: [{ name: "CutHelper 项目", extensions: ["cuthelper.json"] }],
    });
    if (r.canceled || !r.filePath) return null;
    await task("保存项目", async () =>
      atomicFile(r.filePath!, (tmp) =>
        writeFile(tmp, JSON.stringify(p, null, 2)),
      ),
    );
    return r.filePath;
  });
  handle("open", async () => {
    const r = await dialog.showOpenDialog(win, {
      filters: [{ name: "CutHelper 项目", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    return task("打开项目", async (signal) => {
      const size = (await stat(r.filePaths[0])).size;
      if (size > 16e6) throw new Error("项目文件过大");
      let p = projectSchema.parse(
        JSON.parse(await readFile(r.filePaths[0], "utf8")),
      );
      let valid = false;
      try {
        const s = await stat(p.media.path);
        valid =
          s.size === p.media.size && Math.abs(s.mtimeMs - p.media.mtimeMs) < 2;
      } catch {}
      if (!valid) {
        const answer = await dialog.showMessageBox(win, {
          type: "warning",
          message: "原素材缺失或已变化，请重新定位同一素材",
          buttons: ["重新定位", "取消"],
          cancelId: 1,
        });
        if (answer.response === 1) return null;
        const file = await pickMedia();
        if (!file) return null;
        const media = await engine.importMedia(file, signal);
        const previous = p.media;
        if (media.kind === "audio" || previous.kind === "audio") {
          if (media.kind !== "audio" || previous.kind !== "audio" ||
              media.audioRate !== previous.audioRate ||
              Math.abs(media.durationUs - previous.durationUs) > 1000)
            throw new Error("重新定位的素材与项目音频时长或采样率不匹配");
        } else if (
          Math.abs(media.durationUs - previous.durationUs) > frameUs(media) ||
          media.width !== previous.width || media.height !== previous.height ||
          Math.abs(media.fpsNum / media.fpsDen - previous.fpsNum / previous.fpsDen) > 0.001
        ) {
          throw new Error("重新定位的素材与项目时长、分辨率或帧率不匹配");
        }
        p = projectSchema.parse({ ...p, media });
      }
      if (
        p.candidates.some((c) => c.endUs > p.media.durationUs) ||
        p.transcript?.segments.some((s) => s.endUs > p.media.durationUs)
      )
        throw new Error("项目包含无效剪辑区间");
      return loaded(p.media, signal, p);
    });
  });
  handle("export", async (raw: unknown, kind: ExportKind) => {
    const p = checked(raw);
    if (
      !["mp4", "premiere", "resolve", "fcpxml", "jianying", "srt", "source-srt"].includes(
        kind,
      )
    )
      throw new Error("未知导出类型");
    const media = p.media;
    if (kind === "srt" || kind === "source-srt") {
      const source = kind === "source-srt";
      if (!source && media.kind === "audio")
        throw new Error("纯音频项目可导出原始字幕 SRT");
      const subtitle = subtitleSrt(p, source ? "source" : "cut");
      const label = source ? "原始" : "粗剪";
      const result = await dialog.showSaveDialog(win, {
        defaultPath: `${path.parse(media.name).name}-${label}.srt`,
        filters: [{ name: "SRT 字幕", extensions: ["srt"] }],
      });
      if (result.canceled || !result.filePath) return null;
      await task(`导出${label}字幕`, async () =>
        atomicFile(result.filePath!, (temp) => writeFile(temp, subtitle, "utf8")),
      );
      return result.filePath;
    }
    if (media.kind === "audio") throw new Error("纯音频项目可导出原始字幕 SRT");
    const rs = projectRanges(p);
    if (!rs.length) throw new Error("没有保留片段，请先恢复至少一段");
    if (kind === "jianying") {
      const r = await dialog.showOpenDialog(win, {
        title: "选择素材包保存目录",
        properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled) return null;
      return task("导出剪映素材包", async (signal) => {
        const destination = path.join(
          r.filePaths[0],
          `CutHelper-${Date.now()}`,
        );
        const temporary = destination + ".partial";
        await mkdir(temporary);
        try {
          for (let i = 0; i < rs.length; i++) {
            await engine.render(
              media,
              [rs[i]],
              path.join(temporary, `${String(i + 1).padStart(5, "0")}.mp4`),
              signal,
            );
          }
          await writeFile(
            path.join(temporary, "片段清单.json"),
            JSON.stringify(rs, null, 2),
          );
          await writeFile(
            path.join(temporary, "导入说明.txt"),
            "在剪映中批量导入本目录 MP4，按文件名升序选中并拖入时间线。\n这是分段素材包，不是剪映原生草稿，不包含已删除片段的裁切余量。",
          );
          await rename(temporary, destination);
          return destination;
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      });
    }
    const ext = kind === "mp4" ? "mp4" : kind === "fcpxml" ? "fcpxml" : "xml";
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `${path.parse(p.media.name).name}-粗剪.${ext}`,
      filters: [{ name: kind, extensions: [ext] }],
    });
    if (r.canceled || !r.filePath) return null;
    return task("导出", async (signal) => {
      let outputProject = p;
      if (media.normalized && kind !== "mp4") {
        const folder = path.join(
          path.dirname(r.filePath!),
          path.parse(r.filePath!).name + "-媒体",
        );
        await mkdir(folder, { recursive: true });
        const working = path.join(folder, path.basename(p.media.path));
        await atomicFile(working, (t) => copyFile(p.media.path, t));
        outputProject = { ...p, media: { ...p.media, path: working } };
      }
      await atomicFile(r.filePath!, (tmp) =>
        kind === "mp4"
          ? engine.render(media, rs, tmp, signal)
          : writeFile(
              tmp,
              kind === "fcpxml"
                ? fcpxml(outputProject)
                : fcp7(outputProject, kind as "premiere" | "resolve"),
            ),
      );
      if (kind !== "mp4")
        await writeFile(
          r.filePath! + ".导入说明.txt",
          `${kind === "fcpxml" ? "Final Cut Pro：文件 → 导入 → XML" : kind === "resolve" ? "DaVinci Resolve：文件 → 导入 → 时间线" : "Premiere：文件 → 导入"}\n请保持素材路径可访问；出现离线素材时重新链接。此文件仅包含顺序剪辑与音频，无特效或转场。`,
        );
      return r.filePath;
    });
  });
  handle("cancel", () => controller?.abort());
  if (process.env.CUTHELPER_DEV_URL && !app.isPackaged)
    await win.loadURL(process.env.CUTHELPER_DEV_URL);
  else await win.loadFile(path.join(here, "../../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  controller?.abort();
  for (const file of tempPreviews) void rm(file, { force: true });
});
