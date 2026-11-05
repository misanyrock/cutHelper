import { CircleHelp, Play } from "lucide-react";
import { formatTime, type Params } from "../../shared/model";
export default function Inspector({
  params,
  onChange,
  onAnalyze,
  busy,
  ready,
  original,
  cut,
  stale,
}: {
  params: Params;
  onChange: (p: Params) => void;
  onAnalyze: () => void;
  busy: boolean;
  ready: boolean;
  original: number;
  cut: number;
  stale: boolean;
}) {
  const fields = [
    {
      key: "thresholdDb" as const,
      label: "静音阈值",
      min: -65,
      max: -15,
      step: 1,
      unit: "dB",
      hint: "音量低于此值时才计为静音。轻声被误删时，降低阈值。",
    },
    {
      key: "minSilence" as const,
      label: "最短停顿",
      min: 0.2,
      max: 3,
      step: 0.1,
      unit: "秒",
      hint: "只处理持续达到此时长的静音，避免切掉正常语句间隔。",
    },
    {
      key: "padding" as const,
      label: "语音保护",
      min: 0,
      max: 0.4,
      step: 0.01,
      unit: "秒",
      hint: "静音两侧留下的缓冲时长，用于保护词尾和呼吸。",
    },
  ];
  return (
    <aside className="inspector panel">
      <h2>自动粗剪</h2>
      <div className="params">
        {fields.map((f) => (
          <label className="param" key={f.key}>
            <span>
              {f.label}
              <span title={f.hint}>
                <CircleHelp size={15} />
              </span>
            </span>
            <div>
              <input
                aria-label={f.label}
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={params[f.key]}
                disabled={busy}
                onChange={(e) =>
                  onChange({ ...params, [f.key]: +e.target.value })
                }
              />
              <output>
                {params[f.key]} <small>{f.unit}</small>
              </output>
            </div>
          </label>
        ))}
      </div>
      <button
        className="button primary analyze"
        disabled={!ready || busy}
        onClick={onAnalyze}
      >
        <Play size={18} />
        {stale ? "重新分析停顿" : "分析停顿"}
      </button>
      {stale ? (
        <p className="hint">参数已修改，重新分析将替换当前片段选择。</p>
      ) : null}
      <div className="results">
        <h3>分析结果</h3>
        <div>
          <span>
            原片<strong>{formatTime(original)}</strong>
          </span>
          <span>
            粗剪<strong>{formatTime(cut)}</strong>
          </span>
          <span>
            节省
            <strong className="teal">
              {formatTime(Math.max(0, original - cut))}
            </strong>
          </span>
        </div>
      </div>
    </aside>
  );
}
