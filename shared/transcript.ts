import {
  projectRanges,
  sourceToCut,
  type Project,
  type TranscriptSegment,
} from "./model.js";

export function parseWhisperOutput(
  raw: unknown,
  durationUs: number,
): TranscriptSegment[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { transcription?: unknown }).transcription)
  )
    throw new Error("转写结果格式无效");
  const result: TranscriptSegment[] = [];
  let previousEnd = 0;
  for (const entry of (raw as { transcription: unknown[] }).transcription) {
    if (!entry || typeof entry !== "object")
      throw new Error("转写段落格式无效");
    const row = entry as {
      offsets?: { from?: unknown; to?: unknown };
      text?: unknown;
    };
    if (
      typeof row.offsets?.from !== "number" ||
      typeof row.offsets.to !== "number" ||
      typeof row.text !== "string" ||
      !Number.isFinite(row.offsets.from) ||
      !Number.isFinite(row.offsets.to) ||
      row.offsets.from < 0 ||
      row.offsets.to <= row.offsets.from
    )
      throw new Error("转写时间戳无效");
    const startUs = Math.max(previousEnd, Math.round(row.offsets.from * 1000)),
      endUs = Math.min(durationUs, Math.round(row.offsets.to * 1000));
    const text = row.text.trim();
    if (!text || /^\[[^\]]+\]$/.test(text) || endUs <= startUs) continue;
    result.push({
      id: String(result.length + 1),
      startUs,
      endUs,
      text,
      originalText: text,
      remove: false,
    });
    previousEnd = endUs;
  }
  if (!result.length)
    throw new Error("未识别到有效语音，请检查音轨或更换语言后重试");
  return result;
}

function srtTime(us: number) {
  const ms = Math.max(0, Math.round(us / 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export function subtitleSrt(p: Project): string {
  if (!p.transcript) throw new Error("请先转写文字，再导出字幕");
  const ranges = projectRanges(p);
  const cues: string[] = [];
  for (const sentence of p.transcript.segments) {
    if (sentence.remove || !sentence.text.trim()) continue;
    const overlaps = ranges
      .map((r) => ({
        startUs: Math.max(r.startUs, sentence.startUs),
        endUs: Math.min(r.endUs, sentence.endUs),
      }))
      .filter((r) => r.endUs > r.startUs);
    if (!overlaps.length) continue;
    const start = sourceToCut(overlaps[0].startUs, ranges),
      end = sourceToCut(overlaps.at(-1)!.endUs, ranges);
    if (Math.round(end / 1000) <= Math.round(start / 1000)) continue;
    cues.push(
      `${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${sentence.text.trim().replace(/\r/g, "").replace(/\n+/g, " ")}\n`,
    );
  }
  if (!cues.length)
    throw new Error("没有可导出的字幕，请恢复至少一段带文字的内容");
  return cues.join("\n");
}
