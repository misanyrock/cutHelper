import { useMemo, useState } from "react";
import {
  Download,
  FolderOpen,
  FileText,
  Play,
  Undo2,
  Pencil,
  Check,
  RotateCcw,
} from "lucide-react";
import {
  formatTime,
  type Transcript,
  type TranscriptSegment,
  type ModelStatus,
  type Candidate,
} from "../../shared/model";
type Props = {
  available: boolean;
  transcript: Transcript | null;
  model: ModelStatus | null;
  ready: boolean;
  busy: boolean;
  current: number;
  silences: Candidate[];
  canUndo: boolean;
  onSeek: (us: number) => void;
  onTranscribe: (language: "auto" | "zh" | "en") => void;
  onDownload: () => void;
  onImport: () => void;
  onChange: (segments: TranscriptSegment[]) => void;
  onRestoreSilence: (start: number, end: number) => void;
  onUndo: () => void;
};
export default function TranscriptPanel(p: Props) {
  const [language, setLanguage] = useState<"auto" | "zh" | "en">(
      p.transcript?.language ?? "zh",
    ),
    [selected, setSelected] = useState<string[]>([]),
    [anchor, setAnchor] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState("");
  const segments = p.transcript?.segments ?? [];
  const visible = useMemo(
    () =>
      segments.filter((s) =>
        s.text.toLowerCase().includes(query.toLowerCase()),
      ),
    [segments, query],
  );
  const chosen = new Set(selected);
  const changeSelected = (remove: boolean) => {
    p.onChange(segments.map((s) => (chosen.has(s.id) ? { ...s, remove } : s)));
  };
  function select(id: string, shift: boolean) {
    if (shift && anchor) {
      const a = visible.findIndex((s) => s.id === anchor),
        b = visible.findIndex((s) => s.id === id);
      if (a >= 0 && b >= 0) {
        setSelected(
          visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.id),
        );
        return;
      }
    }
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
    setAnchor(id);
  }
  function commitText() {
    if (!editing) return;
    const value = draft.trim();
    if (value)
      p.onChange(
        segments.map((s) => (s.id === editing ? { ...s, text: value } : s)),
      );
    setEditing(null);
  }
  return (
    <section className="transcript-panel" aria-label="文字剪辑">
      <div className="transcript-heading">
        <h2>文字剪辑</h2>
        <button
          title="撤销上一次剪辑"
          aria-label="撤销剪辑"
          disabled={!p.canUndo || p.busy}
          onClick={p.onUndo}
        >
          <Undo2 size={17} />
        </button>
      </div>
      <details
        className="model-settings"
        open={!p.model?.ready ? true : undefined}
      >
        <summary>
          {p.model?.ready ? "本地语音模型已就绪" : "首次使用：准备语音模型"}
        </summary>
        <p>
          {p.model?.ready
            ? p.model.name
            : "Small 多语言模型 · 约 465 MiB，下载一次后离线使用"}
        </p>
        <div>
          <button
            className="button compact"
            disabled={p.busy || !p.available}
            onClick={p.onDownload}
          >
            <Download size={14} />
            {p.model?.ready ? "重新下载" : "下载模型"}
          </button>
          <button
            className="button compact"
            disabled={p.busy || !p.available}
            onClick={p.onImport}
          >
            <FolderOpen size={14} />
            导入模型
          </button>
        </div>
        {p.model && !p.model.runtimeReady ? (
          <p className="speech-warning">离线语音组件缺失，请安装完整版应用。</p>
        ) : null}
      </details>
      <div className="transcribe-actions">
        <select
          aria-label="转写语言"
          value={language}
          disabled={p.busy}
          onChange={(e) => setLanguage(e.target.value as typeof language)}
        >
          <option value="zh">普通话</option>
          <option value="en">英语</option>
          <option value="auto">自动识别</option>
        </select>
        <button
          className="button primary compact"
          disabled={
            p.busy || !p.ready || !p.model?.ready || !p.model.runtimeReady
          }
          onClick={() => {
            setSelected([]);
            setEditing(null);
            p.onTranscribe(language);
          }}
        >
          <FileText size={15} />
          {p.transcript ? "重新转写" : "转写文字"}
        </button>
      </div>
      {p.transcript ? (
        <>
          <input
            className="transcript-search"
            aria-label="搜索文字"
            placeholder="搜索文字，定位内容"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected([]);
            }}
          />
          <div className="sentence-batch">
            <span>已选 {selected.length} 段</span>
            <button
              disabled={p.busy || !selected.length}
              onClick={() => changeSelected(true)}
            >
              删除片段
            </button>
            <button
              disabled={p.busy || !selected.length}
              onClick={() => changeSelected(false)}
            >
              恢复文字
            </button>
          </div>
          <div className="sentence-list" role="list" aria-label="转写段落">
            {visible.map((s) => {
              const talking = p.current >= s.startUs && p.current < s.endUs;
              const overlapping = p.silences.some(
                (c) => c.remove && c.startUs < s.endUs && c.endUs > s.startUs,
              );
              return (
                <article
                  role="listitem"
                  key={s.id}
                  className={`sentence ${s.remove ? "sentence-deleted" : ""} ${talking ? "speaking" : ""} ${chosen.has(s.id) ? "sentence-selected" : ""}`}
                >
                  <div className="sentence-top">
                    <input
                      type="checkbox"
                      aria-label={`选择段落 ${s.id}`}
                      checked={chosen.has(s.id)}
                      disabled={p.busy}
                      onClick={(e) => {
                        select(s.id, e.shiftKey);
                      }}
                      onChange={() => {}}
                    />
                    <button
                      className="sentence-time"
                      title="定位到原片"
                      onClick={() => p.onSeek(s.startUs)}
                    >
                      <Play size={11} />
                      {formatTime(s.startUs, true)} –{" "}
                      {formatTime(s.endUs, true)}
                    </button>
                    <button
                      aria-label={`修正段落 ${s.id}`}
                      title="修正文字，不改变视频时长"
                      disabled={p.busy}
                      onClick={() => {
                        setEditing(s.id);
                        setDraft(s.text);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                  {editing === s.id ? (
                    <div className="sentence-edit">
                      <textarea
                        aria-label="修正文字"
                        value={draft}
                        autoFocus
                        maxLength={20000}
                        disabled={p.busy}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                          if ((e.ctrlKey || e.metaKey) && e.key === "Enter")
                            commitText();
                        }}
                      />
                      <button
                        className="button compact"
                        disabled={!draft.trim() || p.busy}
                        onClick={commitText}
                      >
                        <Check size={13} />
                        完成修正
                      </button>
                      <small>只修正字幕文案，不改变剪辑点</small>
                    </div>
                  ) : (
                    <button
                      className="sentence-text"
                      onClick={() => p.onSeek(s.startUs)}
                    >
                      {s.text}
                    </button>
                  )}
                  <div className="sentence-bottom">
                    <span>
                      {s.remove
                        ? "已删除 · 可恢复"
                        : s.text !== s.originalText
                          ? "文字已修正"
                          : ""}
                    </span>
                    {s.remove ? (
                      <button
                        disabled={p.busy}
                        onClick={() =>
                          p.onChange(
                            segments.map((x) =>
                              x.id === s.id ? { ...x, remove: false } : x,
                            ),
                          )
                        }
                      >
                        <RotateCcw size={12} />
                        恢复
                      </button>
                    ) : null}
                  </div>
                  {!s.remove && overlapping ? (
                    <div className="silence-overlap">
                      <span>此段仍含静音剪切</span>
                      <button
                        disabled={p.busy}
                        onClick={() => p.onRestoreSilence(s.startUs, s.endUs)}
                      >
                        恢复该处静音
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!visible.length ? (
              <p className="transcript-no-results">没有匹配的文字</p>
            ) : null}
          </div>
          <p className="transcript-footnote">
            勾选段落后删除 · Shift 连选 · 点击文字定位原片
          </p>
        </>
      ) : (
        <div className="transcript-empty">
          <FileText size={30} />
          <p>读文字，决定留下什么</p>
          <small>
            转写后可按段落删减和修正字幕。
            <br />
            识别结果需要试听核对。
          </small>
        </div>
      )}
    </section>
  );
}
