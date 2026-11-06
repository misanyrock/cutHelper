import {
  projectRanges,
  type Project,
  type Range,
  type TranscriptSegment,
} from "./model.js";

// Split only at boundaries that Whisper actually timed. Older or incomplete
// results keep their original segment boundaries.
function splitTimedText(
  text: string,
  tokens: unknown,
  start: number,
  end: number,
) {
  const whole = [{ text, start, end }];
  if (!Array.isArray(tokens)) return whole;
  const words: { text: string; from: number; to: number }[] = [];
  for (const token of tokens) {
    if (typeof token?.text !== "string") return whole;
    if (/^\[_.*\]$/.test(token.text)) continue;
    const from = token.offsets?.from;
    const to = token.offsets?.to;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
      return whole;
    words.push({ text: token.text, from, to });
  }
  if (words.map((word) => word.text).join("").trim() !== text) return whole;

  const parts: typeof whole = [];
  let phrase = "";
  let phraseStart = start;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    phrase += word.text;
    if (!next || !phrase.trim()) continue;
    const tail = phrase.trimEnd();
    const punctuation =
      /[。！？；]$/.test(tail) ||
      (/[.!?;]$/.test(tail) && /^\s/.test(next.text));
    const pause =
      next.from - word.to >= 450 && /^\s*[\p{L}\p{N}]/u.test(next.text);
    if (
      (punctuation || pause) &&
      phraseStart < word.to &&
      word.to <= next.from &&
      next.from < end
    ) {
      parts.push({ text: phrase.trim(), start: phraseStart, end: word.to });
      phrase = "";
      phraseStart = next.from;
    }
  }
  if (phrase.trim()) parts.push({ text: phrase.trim(), start: phraseStart, end });
  return parts.length > 1 ? parts : whole;
}

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
      tokens?: unknown;
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
    const text = row.text.trim();
    if (!text || /^\[[^\]]+\]$/.test(text)) continue;
    const parts = splitTimedText(text, row.tokens, row.offsets.from, row.offsets.to);
    for (const part of parts) {
      const startUs = Math.max(previousEnd, Math.round(part.start * 1000));
      const endUs = Math.min(durationUs, Math.round(part.end * 1000));
      if (endUs <= startUs) continue;
      result.push({
        id: String(result.length + 1),
        startUs,
        endUs,
        text: part.text,
        originalText: part.text,
        remove: false,
      });
      previousEnd = endUs;
    }
  }
  if (!result.length)
    throw new Error("未识别到有效语音，请检查音轨或更换语言后重试");
  return result;
}

function srtTime(us: number) {
  const ms = Math.max(0, Math.round(us / 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
const words = new Intl.Segmenter(undefined, { granularity: "word" });
function subtitleLines(text: string) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    let width = 0;
    for (const { segment } of words.segment(paragraph.trim())) {
      const units = Array.from(segment).reduce(
        (sum, char) => sum + (char.codePointAt(0)! <= 127 ? 1 : 2),
        0,
      );
      if (width + units > 42 && line.trim() && /[\p{L}\p{N}]/u.test(segment)) {
        lines.push(line.trim());
        line = "";
        width = 0;
      }
      if (!line && !segment.trim()) continue;
      line += segment;
      width += units;
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines.join("\n");
}

export function subtitleSrt(
  p: Project,
  timeline: "source" | "cut" = "cut",
): string {
  if (!p.transcript) throw new Error("请先转写文字，再导出字幕");
  const ranges: Range[] =
    timeline === "source"
      ? [{ startUs: 0, endUs: p.media.durationUs }]
      : projectRanges(p);
  const cues: string[] = [];
  let rangeIndex = 0;
  let offset = 0;
  for (const sentence of p.transcript.segments) {
    if ((timeline === "cut" && sentence.remove) || !sentence.text.trim()) continue;
    const timing = sentence.subtitleTiming ?? sentence;
    let start: number | undefined;
    let end = 0;
    while (rangeIndex < ranges.length) {
      const range = ranges[rangeIndex];
      if (range.startUs >= timing.endUs) break;
      const from = Math.max(range.startUs, timing.startUs);
      const to = Math.min(range.endUs, timing.endUs);
      if (to > from) {
        start ??= offset + from - range.startUs;
        end = offset + to - range.startUs;
      }
      if (range.endUs > timing.endUs) break;
      offset += range.endUs - range.startUs;
      rangeIndex++;
    }
    if (start === undefined || Math.round(end / 1000) <= Math.round(start / 1000)) continue;
    cues.push(
      `${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${subtitleLines(sentence.text)}\n`,
    );
  }
  if (!cues.length)
    throw new Error("没有可导出的字幕，请恢复至少一段带文字的内容");
  return cues.join("\n");
}
