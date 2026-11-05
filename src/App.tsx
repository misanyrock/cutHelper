import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Upload,
  Download,
  Play,
  Monitor,
  Save,
  Film,
  ChevronDown,
  LoaderCircle,
  X,
  Check,
  Scissors,
  FileVideo,
  RefreshCw,
} from "lucide-react";
import {
  defaults,
  duration,
  keepRanges,
  cutToSource,
  sourceToCut,
  type Project,
  type Candidate,
  type Progress,
  type ExportKind,
} from "../shared/model";
import "./style.css";
import Timeline from "./components/Timeline";
import Inspector from "./components/Inspector";
import Clips from "./components/Clips";
const exports: { kind: ExportKind; label: string; detail: string }[] = [
  { kind: "mp4", label: "视频 MP4", detail: "可直接播放的粗剪成片" },
  {
    kind: "premiere",
    label: "Premiere XML",
    detail: "引用完整素材，保留裁切余量",
  },
  { kind: "resolve", label: "达芬奇 XML", detail: "导入为可继续编辑的时间线" },
  {
    kind: "fcpxml",
    label: "Final Cut Pro FCPXML",
    detail: "FCPXML 1.9 时间线",
  },
  {
    kind: "jianying",
    label: "剪映素材包",
    detail: "顺序编号片段，批量导入剪映",
  },
];
export default function App() {
  const api = window.cuthelper;
  const [project, setProject] = useState<Project | null>(null),
    [waveform, setWaveform] = useState<number[]>([]),
    [sourceUrl, setSourceUrl] = useState(""),
    [cutUrl, setCutUrl] = useState(""),
    [cutRevision, setCutRevision] = useState(""),
    [mode, setMode] = useState<"source" | "cut">("source"),
    [selected, setSelected] = useState<string | null>(null),
    [current, setCurrent] = useState(0),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<Progress | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [menu, setMenu] = useState(false),
    [dragging, setDragging] = useState(false),
    [dirty, setDirty] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    projectRef = useRef(project);
  projectRef.current = project;
  const params = project?.params ?? defaults,
    revision = JSON.stringify(project?.candidates ?? []),
    stalePreview = cutRevision !== revision,
    staleParams =
      !!project?.analyzed &&
      JSON.stringify(project.analysisParams) !== JSON.stringify(params);
  const ranges = useMemo(
      () => (project ? keepRanges(project.media, project.candidates) : []),
      [project],
    ),
    cut = duration(ranges);
  useEffect(() => api?.onProgress(setProgress), [api]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  async function action<T>(fn: () => Promise<T>, success?: string) {
    setError("");
    setNotice("");
    setBusy(true);
    setMenu(false);
    try {
      const result = await fn();
      if (success && result) setNotice(success);
      return result;
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  function accept(
    result:
      Awaited<ReturnType<NonNullable<typeof api>["importVideo"]>> | undefined,
  ) {
    if (!result) return;
    setProject(result.project);
    setWaveform(result.waveform);
    setSourceUrl(result.sourceUrl);
    setCutUrl("");
    setMode("source");
    setSelected(null);
    setCurrent(0);
    setDirty(false);
  }
  function canReplace() {
    return !dirty || confirm("当前项目有未保存的修改，继续将丢弃这些修改。");
  }
  async function importVideo() {
    if (!api || !canReplace()) return;
    accept(await action(() => api.importVideo()));
  }
  async function openProject() {
    if (!api || !canReplace()) return;
    accept(await action(() => api.openProject()));
  }
  function edit(candidates: Candidate[]) {
    setProject((p) => (p ? { ...p, candidates } : p));
    setDirty(true);
    if (mode === "cut") {
      setMode("source");
      setNotice("剪辑已更新，请重新生成粗剪预览。");
    }
  }
  function seek(us: number) {
    setCurrent(us);
    if (video.current)
      video.current.currentTime =
        (mode === "cut" ? sourceToCut(us, ranges) : us) / 1e6;
  }
  async function analyze() {
    if (!api || !project) return;
    if (
      project.analyzed &&
      dirty &&
      !confirm("重新分析会替换当前保留/删除选择，是否继续？")
    )
      return;
    const result = await action(() => api.analyze(params));
    if (result) {
      setProject((p) =>
        p
          ? { ...p, candidates: result, analyzed: true, analysisParams: params }
          : p,
      );
      setSelected(result[0]?.id ?? null);
      setDirty(true);
      setMode("source");
      setCutUrl("");
    }
  }
  async function switchCut() {
    if (!api || !project) return;
    if (!cut) {
      setError("没有保留片段，请先恢复至少一段");
      return;
    }
    if (!cutUrl || stalePreview) {
      const result = await action(() => api.preview(project));
      if (!result) return;
      setCutUrl(result);
      setCutRevision(revision);
    }
    setMode("cut");
    setCurrent(ranges[0]?.startUs ?? 0);
  }
  async function save() {
    if (!api || !project) return;
    const result = await action(() => api.saveProject(project));
    if (result) {
      setDirty(false);
      setNotice(`项目已保存：${result}`);
    }
  }
  async function exportProject(kind: ExportKind) {
    if (!api || !project) return;
    const result = await action(() => api.exportProject(project, kind));
    if (result) setNotice(`导出完成：${result}`);
  }
  return (
    <div
      className={`app ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        if (!api || busy || !canReplace()) return;
        const files = e.dataTransfer.files;
        if (files.length !== 1) {
          setError("一次只能导入一个视频");
          return;
        }
        accept(await action(() => api.importDropped(files[0])));
      }}
    >
      <header className="header">
        <div className="brand">
          <span className="brand-mark">
            <Play fill="currentColor" size={18} />
          </span>
          <h1>CutHelper</h1>
        </div>
        <div className="project-name">
          <Film size={20} />
          <span>
            {project?.media.name ?? "离线口播粗剪"}
            {dirty ? " · 未保存" : ""}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="打开项目"
            title="打开项目"
            disabled={busy || !api}
            onClick={openProject}
          >
            <FolderOpen size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="保存项目"
            title="保存项目"
            disabled={busy || !project}
            onClick={save}
          >
            <Save size={20} />
          </button>
          <button
            className="button"
            disabled={busy || !api}
            onClick={importVideo}
          >
            <FolderOpen size={20} />
            导入视频
          </button>
          <div className="export-wrap">
            <button
              className="button primary"
              aria-expanded={menu}
              disabled={busy || !project || !cut}
              onClick={() => setMenu((v) => !v)}
            >
              <Upload size={19} />
              导出
              <ChevronDown size={15} />
            </button>
            {menu ? (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="关闭导出菜单"
                  onClick={() => setMenu(false)}
                />
                <div className="export-menu">
                  {exports.map((x) => (
                    <button key={x.kind} onClick={() => exportProject(x.kind)}>
                      {x.kind === "jianying" ? (
                        <Scissors size={19} />
                      ) : x.kind === "mp4" ? (
                        <FileVideo size={19} />
                      ) : (
                        <Film size={19} />
                      )}
                      <span>
                        {x.label}
                        <small>{x.detail}</small>
                      </span>
                      <Download size={15} />
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main>
        <div className="workspace">
          <Clips
            candidates={project?.candidates ?? []}
            selected={selected}
            busy={busy}
            analyzed={project?.analyzed ?? false}
            onSelect={(c) => {
              setSelected(c.id);
              seek(c.startUs);
            }}
            onToggle={(id) =>
              edit(
                project!.candidates.map((c) =>
                  c.id === id ? { ...c, remove: !c.remove } : c,
                ),
              )
            }
            onRestore={() =>
              edit(project!.candidates.map((c) => ({ ...c, remove: false })))
            }
          />
          <section className="preview-area">
            <div className="video-frame">
              {sourceUrl ? (
                <video
                  key={mode === "cut" ? cutUrl : sourceUrl}
                  ref={video}
                  src={mode === "cut" ? cutUrl : sourceUrl}
                  controls
                  playsInline
                  onTimeUpdate={(e) =>
                    setCurrent(
                      mode === "cut"
                        ? cutToSource(e.currentTarget.currentTime * 1e6, ranges)
                        : e.currentTarget.currentTime * 1e6,
                    )
                  }
                  onError={() =>
                    setError("预览无法播放，请重新导入视频或生成预览")
                  }
                />
              ) : (
                <div className="import-empty">
                  <span className="empty-icon">
                    <FileVideo size={40} strokeWidth={1.4} />
                  </span>
                  <h2>把停顿留给我们</h2>
                  <p>拖入一段口播视频，开始自动粗剪</p>
                  <button
                    className="button primary"
                    onClick={importVideo}
                    disabled={!api || busy}
                  >
                    <FolderOpen size={18} />
                    选择视频
                  </button>
                  <small>MP4、MOV、MKV · 完全在本机处理</small>
                  {!api ? (
                    <p className="browser-note">
                      请在 CutHelper 桌面应用中导入本地视频
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            <div className="preview-toolbar">
              <div className="mode-toggle">
                <button
                  className={mode === "source" ? "active" : ""}
                  disabled={!project || busy}
                  onClick={() => {
                    setMode("source");
                    setCurrent(0);
                  }}
                >
                  原片
                </button>
                <button
                  className={mode === "cut" ? "active" : ""}
                  disabled={!project || busy}
                  onClick={switchCut}
                >
                  粗剪{cutUrl && stalePreview ? " · 待更新" : ""}
                </button>
              </div>
              {project ? (
                <button
                  className="refresh-preview"
                  disabled={busy || !cut}
                  onClick={() => {
                    setCutRevision("");
                    setCutUrl("");
                    setMode("source");
                    setNotice("下次点击“粗剪”将重新生成预览");
                  }}
                  title="刷新粗剪预览"
                  aria-label="刷新粗剪预览"
                >
                  <RefreshCw size={16} />
                </button>
              ) : null}
            </div>
            {project?.media.normalized ? (
              <p className="normalization-note">
                已生成{" "}
                {(project.media.fpsNum / project.media.fpsDen).toFixed(2)} fps
                工作副本，原素材保持不变
              </p>
            ) : null}
          </section>
          <Inspector
            params={params}
            onChange={(p) => {
              setProject((v) => (v ? { ...v, params: p } : v));
              setDirty(true);
            }}
            onAnalyze={analyze}
            ready={!!project}
            busy={busy}
            original={project?.media.durationUs ?? 0}
            cut={cut}
            stale={staleParams}
          />
        </div>
        <Timeline
          busy={busy}
          media={project?.media ?? null}
          waveform={waveform}
          candidates={project?.candidates ?? []}
          selected={selected}
          current={current}
          onSeek={seek}
          onSelect={setSelected}
          onRestore={() =>
            edit(
              project!.candidates.map((c) =>
                c.id === selected ? { ...c, remove: false } : c,
              ),
            )
          }
        />
      </main>
      <footer>
        <span>
          <Monitor size={16} />
          本地处理
          <span className="footer-dot" />
          素材不会上传
        </span>
        <span>
          {project
            ? `${project.media.width} × ${project.media.height} · ${(project.media.fpsNum / project.media.fpsDen).toFixed(2)} fps`
            : "准备就绪"}
        </span>
      </footer>
      {busy ? (
        <div className="task-banner" role="status">
          <LoaderCircle className="spin" size={20} />
          <div>
            <strong>{progress?.stage ?? "准备中"}</strong>
            {progress?.percent !== null && progress?.percent !== undefined ? (
              <>
                <progress max={100} value={progress.percent} />
                <small>{Math.floor(progress.percent)}%</small>
              </>
            ) : (
              <span>正在读取素材…</span>
            )}
          </div>
          <button className="button compact" onClick={() => api?.cancel()}>
            取消任务
          </button>
        </div>
      ) : null}
      {error || notice ? (
        <div
          className={`toast ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ? <X size={19} /> : <Check size={19} />}
          <span>{error || notice}</span>
          <button
            aria-label="关闭提示"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {dragging ? (
        <div className="drop-overlay">
          <Upload size={40} />
          <h2>松开以导入视频</h2>
          <p>一次处理一个视频，素材始终留在本机</p>
        </div>
      ) : null}
    </div>
  );
}
