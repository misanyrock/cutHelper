import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import {
  FolderOpen,
  Upload,
  Download,
  Monitor,
  Save,
  Film,
  ChevronDown,
  LoaderCircle,
  X,
  Check,
  Scissors,
  FileVideo,
  FileText,
  Headphones,
  RefreshCw,
} from "lucide-react";
import {
  defaults,
  duration,
  formatTime,
  projectRanges,
  cutCandidates,
  type ModelStatus,
  type TranscriptSegment,
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
import TranscriptPanel from "./components/TranscriptPanel";
const exports: { kind: ExportKind; label: string; detail: string }[] = [
  { kind: "source-srt", label: "原始字幕 SRT", detail: "按原素材时间导出全部文字" },
  { kind: "srt", label: "粗剪字幕 SRT", detail: "字幕时间与粗剪视频同步" },
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
    [dirty, setDirty] = useState(false),
    [sidebar, setSidebar] = useState<"text" | "silence">("text"),
    [speechModel, setSpeechModel] = useState<ModelStatus | null>(null),
    [historyCount, setHistoryCount] = useState(0),
    [editorSession, setEditorSession] = useState(0);
  const history = useRef<Project[]>([]),
    pendingSeek = useRef<number | null>(null);
  const player = useRef<HTMLMediaElement | null>(null),
    projectRef = useRef(project);
  const connectPlayer = useCallback((element: HTMLMediaElement | null) => {
    player.current = element;
  }, []);
  projectRef.current = project;
  const audioOnly = project?.media.kind === "audio";
  const params = project?.params ?? defaults,
    revision = JSON.stringify(
      project
        ? cutCandidates(project).map((c) => [c.startUs, c.endUs, c.remove])
        : [],
    ),
    stalePreview = cutRevision !== revision,
    staleParams =
      !!project?.analyzed &&
      JSON.stringify(project.analysisParams) !== JSON.stringify(params);
  const ranges = useMemo(
      () => (project ? projectRanges(project) : []),
      [project],
    ),
    cut = duration(ranges);
  useEffect(() => api?.onProgress(setProgress), [api]);
  useEffect(() => {
    if (api)
      void api
        .modelStatus()
        .then(setSpeechModel)
        .catch(() => {});
  }, [api]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        !event.shiftKey &&
        !busy &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement)?.tagName,
        )
      ) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [busy]);
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
      Awaited<ReturnType<NonNullable<typeof api>["importMedia"]>> | undefined,
  ) {
    if (!result) return;
    setProject(result.project);
    setEditorSession((value) => value + 1);
    history.current = [];
    setHistoryCount(0);
    setWaveform(result.waveform);
    setSourceUrl(result.sourceUrl);
    setCutUrl("");
    pendingSeek.current = null;
    setMode("source");
    if (result.project.media.kind === "audio") setSidebar("text");
    setSelected(null);
    setCurrent(0);
    setDirty(false);
  }
  function canReplace() {
    return !dirty || confirm("当前项目有未保存的修改，继续将丢弃这些修改。");
  }
  async function importMedia() {
    if (!api || !canReplace()) return;
    accept(await action(() => api.importMedia()));
  }
  async function openProject() {
    if (!api || !canReplace()) return;
    accept(await action(() => api.openProject()));
  }
  function commitProject(next: Project, affectsCut = true) {
    if (!projectRef.current) return;
    history.current.push(projectRef.current);
    if (history.current.length > 30) history.current.shift();
    setHistoryCount(history.current.length);
    setProject(next);
    setDirty(true);
    if (affectsCut && mode === "cut") {
      setMode("source");
      setNotice("剪辑已更新，点击“粗剪”重新生成预览。");
    }
  }
  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    setHistoryCount(history.current.length);
    setProject(previous);
    setDirty(true);
    setMode("source");
    setNotice("已撤销上一次剪辑");
  }
  function edit(candidates: Candidate[]) {
    if (!projectRef.current) return;
    commitProject({ ...projectRef.current, candidates });
    if (mode === "cut") {
      setMode("source");
      setNotice("剪辑已更新，请重新生成粗剪预览。");
    }
  }
  function seek(us: number) {
    setCurrent(us);
    const target = mode === "cut" ? sourceToCut(us, ranges) : us;
    if (player.current && player.current.readyState >= 1)
      player.current.currentTime = target / 1e6;
    else pendingSeek.current = target;
  }
  function seekSource(us: number) {
    setCurrent(us);
    pendingSeek.current = us;
    if (mode !== "source") {
      setMode("source");
      return;
    }
    if (player.current && player.current.readyState >= 1) {
      player.current.currentTime = us / 1e6;
      pendingSeek.current = null;
    }
  }
  async function changeModel(kind: "download" | "import") {
    if (!api) return;
    const result = await action(() =>
      kind === "download" ? api.downloadModel() : api.importModel(),
    );
    if (result) setSpeechModel(result);
  }
  async function transcribe(language: "auto" | "zh" | "en") {
    if (!api || !projectRef.current) return;
    if (
      projectRef.current.transcript &&
      !confirm(
        "重新转写将替换文字修正和文字删除选择，静音选择会保留。可通过撤销恢复。",
      )
    )
      return;
    const result = await action(() => api.transcribe(language));
    if (result && projectRef.current) {
      commitProject({ ...projectRef.current, transcript: result });
      setSidebar("text");
      setNotice(
        `已转写 ${result.segments.length} 段文字，点击段落可试听核对。`,
      );
    }
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
      if (projectRef.current)
        commitProject({
          ...projectRef.current,
          candidates: result,
          analyzed: true,
          analysisParams: params,
        });
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
  const playbackProps = {
    ref: connectPlayer,
    src: mode === "cut" ? cutUrl : sourceUrl,
    controls: true,
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      if (pendingSeek.current !== null) {
        event.currentTarget.currentTime = pendingSeek.current / 1e6;
        pendingSeek.current = null;
      }
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => {
      const position = event.currentTarget.currentTime * 1e6;
      setCurrent(mode === "cut" ? cutToSource(position, ranges) : position);
    },
    onError: () => setError("无法播放预览，请重新导入素材或生成预览"),
  };
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
          setError("一次只能导入一个素材");
          return;
        }
        accept(await action(() => api.importDropped(files[0])));
      }}
    >
      <header className="header">
        <div className="brand">
          <img
            className="brand-mark"
            src={`${import.meta.env.BASE_URL}icon.svg`}
            alt=""
          />
          <h1>CutHelper</h1>
        </div>
        <div className="project-name">
          {audioOnly ? <Headphones size={20} /> : <Film size={20} />}
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
            onClick={importMedia}
          >
            <FolderOpen size={20} />
            导入素材
          </button>
          <div className="export-wrap">
            <button
              className="button primary"
              aria-expanded={menu}
              disabled={busy || !project || (!project.transcript && (audioOnly || !cut))}
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
                  {exports.filter((x) => !audioOnly || x.kind === "source-srt").map((x) => (
                    <button
                      key={x.kind}
                      disabled={x.kind === "source-srt" ? !project?.transcript :
                        !cut || (x.kind === "srt" && !project?.transcript)}
                      onClick={() => exportProject(x.kind)}
                    >
                      {x.kind === "source-srt" || x.kind === "srt" ? (
                        <FileText size={19} />
                      ) : x.kind === "jianying" ? (
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
        <div className={`workspace ${sidebar === "text" ? "text-mode" : ""}`}>
          <aside className="editing-sidebar panel">
            {!audioOnly ? <div className="sidebar-tabs" role="tablist" aria-label="剪辑方式">
              <button
                role="tab"
                aria-selected={sidebar === "text"}
                onClick={() => setSidebar("text")}
              >
                文字
              </button>
              <button
                role="tab"
                aria-selected={sidebar === "silence"}
                onClick={() => setSidebar("silence")}
              >
                静音
              </button>
            </div> : null}
            {audioOnly || sidebar === "text" ? (
              <TranscriptPanel
                key={editorSession}
                available={!!api}
                transcript={project?.transcript ?? null}
                model={speechModel}
                ready={!!project}
                subtitleOnly={audioOnly}
                durationUs={project?.media.durationUs ?? 0}
                busy={busy}
                current={current}
                silences={project?.candidates ?? []}
                canUndo={historyCount > 0}
                onUndo={undo}
                onSeek={seekSource}
                onDownload={() => changeModel("download")}
                onImport={() => changeModel("import")}
                onTranscribe={transcribe}
                onChange={(segments: TranscriptSegment[]) => {
                  if (!project?.transcript) return;
                  const transcript = project.transcript;
                  const affectsCut = segments.some((s, index) => s.remove !== transcript.segments[index]?.remove);
                  commitProject({
                    ...project,
                    transcript: { ...transcript, segments },
                  }, affectsCut);
                }}
                onRestoreSilence={(start, end) =>
                  edit(
                    project!.candidates.map((c) =>
                      c.startUs < end && c.endUs > start
                        ? { ...c, remove: false }
                        : c,
                    ),
                  )
                }
              />
            ) : (
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
                  edit(
                    project!.candidates.map((c) => ({ ...c, remove: false })),
                  )
                }
              />
            )}
          </aside>
          <section className="preview-area">
            <div className="video-frame">
              {sourceUrl ? audioOnly ? (
                <div className="audio-preview">
                  <Headphones className="empty-icon" size={40} strokeWidth={1.4} />
                  <h2>音频试听</h2>
                  <p>{project.media.name}</p>
                  <audio key={sourceUrl} {...playbackProps} aria-label="原始音频" />
                </div>
              ) : (
                <video key={playbackProps.src} {...playbackProps} playsInline />
              ) : (
                <div className="import-empty">
                  <span className="empty-icon">
                    <FileVideo size={40} strokeWidth={1.4} />
                  </span>
                  <h2>把停顿留给我们</h2>
                  <p>拖入视频或音频，开始粗剪或生成字幕</p>
                  <button
                    className="button primary"
                    onClick={importMedia}
                    disabled={!api || busy}
                  >
                    <FolderOpen size={18} />
                    选择素材
                  </button>
                  <small>MP4、MOV、MKV、MP3、WAV、M4A · 本机处理</small>
                  {!api ? (
                    <p className="browser-note">
                      请在 CutHelper 桌面应用中导入本地素材
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            {!audioOnly ? <div className="preview-toolbar">
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
            </div> : null}
            {project && project.media.kind !== "audio" && project.media.normalized ? (
              <p className="normalization-note">
                已生成{" "}
                {(project.media.fpsNum / project.media.fpsDen).toFixed(2)} fps
                工作副本，原素材保持不变
              </p>
            ) : null}
          </section>
          {audioOnly ? (
            <aside className="inspector panel audio-inspector">
              <h2>音频字幕</h2>
              <ol>
                <li>选择语言，转写本地音频</li>
                <li>点击段落试听，校对文字和时间</li>
                <li>导出原始字幕 SRT</li>
              </ol>
              <div className="results">
                <h3>音频时长</h3>
                <strong>{formatTime(project.media.durationUs, true)}</strong>
              </div>
            </aside>
          ) : <Inspector
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
          />}
        </div>
        <Timeline
          busy={busy}
          media={project?.media ?? null}
          waveform={waveform}
          candidates={project ? cutCandidates(project) : []}
          selected={selected}
          current={current}
          onSeek={seek}
          onSelect={setSelected}
          onRestore={() => {
            if (!project) return;
            if (selected?.startsWith("text:") && project.transcript)
              commitProject({
                ...project,
                transcript: {
                  ...project.transcript,
                  segments: project.transcript.segments.map((s) =>
                    `text:${s.id}` === selected ? { ...s, remove: false } : s,
                  ),
                },
              });
            else
              edit(
                project.candidates.map((c) =>
                  c.id === selected ? { ...c, remove: false } : c,
                ),
              );
          }}
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
            ? project.media.kind === "audio"
              ? `${project.media.audioRate / 1000} kHz · ${project.media.audioChannels === 1 ? "单声道" : "双声道试听"}`
              : `${project.media.width} × ${project.media.height} · ${(project.media.fpsNum / project.media.fpsDen).toFixed(2)} fps`
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
          <h2>松开以导入素材</h2>
          <p>一次处理一个视频或音频，素材始终留在本机</p>
        </div>
      ) : null}
    </div>
  );
}
