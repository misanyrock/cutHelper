import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { formatTime, type Candidate, type Media } from "../../shared/model";
export default function Timeline({
  media,
  waveform,
  candidates,
  selected,
  current,
  onSeek,
  onSelect,
  onRestore,
  busy,
}: {
  media: Media | null;
  waveform: number[];
  candidates: Candidate[];
  selected: string | null;
  current: number;
  onSeek: (us: number) => void;
  onSelect: (id: string) => void;
  onRestore: () => void;
  busy: boolean;
}) {
  const [zoom, setZoom] = useState(1),
    canvas = useRef<HTMLCanvasElement>(null);
  const duration = media?.durationUs ?? 0;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const draw = () => {
      const w = el.clientWidth,
        h = el.clientHeight,
        dpr = devicePixelRatio;
      el.width = w * dpr;
      el.height = h * dpr;
      const c = el.getContext("2d")!;
      c.scale(dpr, dpr);
      c.clearRect(0, 0, w, h);
      c.strokeStyle = "#29a49b";
      c.lineWidth = 1;
      for (let x = 0; x < w; x += 2) {
        const sample = waveform[Math.floor((x / w) * waveform.length)] ?? 0;
        const v = Math.max(1, sample * (h / 2 - 10));
        c.beginPath();
        c.moveTo(x, h / 2 - v);
        c.lineTo(x, h / 2 + v);
        c.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [waveform, zoom]);
  const item = candidates.find((c) => c.id === selected);
  return (
    <section className="timeline panel" aria-label="波形时间轴">
      <div className="timeline-heading">
        <h2>波形时间轴</h2>
        <span className="legend">
          <i />
          保留（有语音）
          <i className="removed" />
          删除（静音）
        </span>
        <div className="zoom">
          <span>缩放</span>
          <button
            aria-label="缩小时间线"
            onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
          >
            <ZoomOut size={18} />
          </button>
          <input
            aria-label="时间线缩放"
            type="range"
            min="1"
            max="5"
            step=".5"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
          <button
            aria-label="放大时间线"
            onClick={() => setZoom((z) => Math.min(5, z + 0.5))}
          >
            <ZoomIn size={18} />
          </button>
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-inner" style={{ width: `${zoom * 100}%` }}>
          <div className="ruler">
            {Array.from({ length: 13 }, (_, i) => (
              <span key={i}>{formatTime((duration * i) / 12)}</span>
            ))}
          </div>
          <div
            className="wave"
            role="slider"
            tabIndex={0}
            aria-label="定位原片"
            aria-valuemin={0}
            aria-valuemax={duration / 1e6}
            aria-valuenow={current / 1e6}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight")
                onSeek(Math.min(duration, current + 1e6));
              if (e.key === "ArrowLeft") onSeek(Math.max(0, current - 1e6));
            }}
            onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              onSeek(((e.clientX - b.left) / b.width) * duration);
            }}
          >
            <canvas ref={canvas} />
            {candidates.map((c) => (
              <button
                key={c.id}
                aria-label={`定位静音 ${c.id}`}
                className={`region ${c.remove ? "deleted" : "kept"} ${selected === c.id ? "selected" : ""}`}
                style={{
                  left: `${(c.startUs / duration) * 100}%`,
                  width: `${Math.max(0.12, ((c.endUs - c.startUs) / duration) * 100)}%`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(c.id);
                  onSeek(c.startUs);
                }}
              >
                <span>{c.id}</span>
              </button>
            ))}
            {media ? (
              <div
                className="playhead"
                style={{
                  left: `${Math.min(100, (current / duration) * 100)}%`,
                }}
              />
            ) : (
              <div className="wave-empty">导入视频后，波形将在这里显示</div>
            )}
          </div>
        </div>
      </div>
      <div className="selection">
        <span>
          {item
            ? `当前选中： ${formatTime(item.startUs, true)} – ${formatTime(item.endUs, true)} （时长 ${((item.endUs - item.startUs) / 1e6).toFixed(2)} 秒）`
            : "点击波形定位，选择静音片段检查剪辑点"}
        </span>
        <button
          className="button compact"
          disabled={busy || !item?.remove}
          onClick={onRestore}
        >
          <RotateCcw size={16} />
          恢复此段
        </button>
      </div>
    </section>
  );
}
