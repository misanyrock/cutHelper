import { RotateCcw, AudioLines } from "lucide-react";
import { formatTime, type Candidate } from "../../shared/model";
export default function Clips({
  candidates,
  selected,
  onSelect,
  onToggle,
  onRestore,
  busy,
  analyzed,
}: {
  candidates: Candidate[];
  selected: string | null;
  onSelect: (c: Candidate) => void;
  onToggle: (id: string) => void;
  onRestore: () => void;
  busy: boolean;
  analyzed: boolean;
}) {
  return (
    <aside className="clips panel">
      <div className="clips-title">
        <h2>静音片段</h2>
        <button
          title="恢复全部片段"
          aria-label="恢复全部片段"
          disabled={busy || !candidates.some((c) => c.remove)}
          onClick={onRestore}
        >
          <RotateCcw size={17} />
        </button>
      </div>
      <p className="subtle">
        {analyzed
          ? `共发现 ${candidates.length} 段候选静音`
          : "检查每一处停顿，保留你的节奏"}
      </p>
      <div className="clip-list">
        {candidates.length ? (
          candidates.map((c, i) => (
            <div
              key={c.id}
              className={`clip ${selected === c.id ? "active" : ""}`}
            >
              <button className="clip-info" onClick={() => onSelect(c)}>
                <span className="number">{i + 1}</span>
                <span>
                  <strong>
                    {formatTime(c.startUs, true)} – {formatTime(c.endUs, true)}
                  </strong>
                  <small>
                    时长 {((c.endUs - c.startUs) / 1e6).toFixed(2)} 秒
                  </small>
                </span>
              </button>
              <button
                role="switch"
                aria-checked={c.remove}
                aria-label={`删除静音 ${c.id}`}
                disabled={busy}
                className={`cut-switch ${c.remove ? "on" : ""}`}
                onClick={() => onToggle(c.id)}
              >
                <span />
                {c.remove ? "删除" : "保留"}
              </button>
            </div>
          ))
        ) : (
          <div className="clip-empty">
            <AudioLines size={30} />
            <p>{analyzed ? "没有检测到符合条件的停顿" : "等待分析停顿"}</p>
            <small>
              {analyzed ? "试试调整阈值或最短停顿" : "导入视频，分析后逐段检查"}
            </small>
          </div>
        )}
      </div>
    </aside>
  );
}
