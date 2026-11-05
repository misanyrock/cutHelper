import { z } from "zod";
import { rationalMax } from "./frame-rate.js";
export const paramsSchema = z.object({
  thresholdDb: z.number().min(-65).max(-15),
  minSilence: z.number().min(0.2).max(3),
  padding: z.number().min(0).max(0.4),
});
export type Params = z.infer<typeof paramsSchema>;
export const defaults: Params = {
  thresholdDb: -35,
  minSilence: 0.6,
  padding: 0.12,
};
export const rangeSchema = z
  .object({
    startUs: z.number().int().nonnegative(),
    endUs: z.number().int().nonnegative(),
  })
  .refine((v) => v.endUs > v.startUs);
export type Range = z.infer<typeof rangeSchema>;
export const candidateSchema = rangeSchema.safeExtend({
  id: z.string(),
  remove: z.boolean(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const mediaSchema = z.object({
  path: z.string(),
  originalPath: z.string(),
  name: z.string(),
  durationUs: z.number().int().positive(),
  fpsNum: z.number().int().positive().max(rationalMax),
  fpsDen: z.number().int().positive().max(rationalMax),
  width: z.number().positive(),
  height: z.number().positive(),
  audioChannels: z.number().int().min(1).max(2),
  audioRate: z.number().positive(),
  size: z.number().nonnegative(),
  mtimeMs: z.number(),
  normalized: z.boolean(),
  rotation: z.number().default(0),
  videoIndex: z.number().int().nonnegative(),
  audioIndex: z.number().int().nonnegative(),
});
export type Media = z.infer<typeof mediaSchema>;
export const transcriptSegmentSchema = rangeSchema.safeExtend({
  id: z.string().min(1),
  text: z.string().max(20000),
  originalText: z.string().max(20000),
  remove: z.boolean().default(false),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export const transcriptSchema = z.object({
  language: z.enum(["auto", "zh", "en"]),
  modelHash: z.string(),
  createdAt: z.string(),
  segments: z.array(transcriptSegmentSchema).max(100000),
});
export type Transcript = z.infer<typeof transcriptSchema>;
export const projectSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    media: mediaSchema,
    params: paramsSchema,
    candidates: z.array(candidateSchema).max(100000),
    analyzed: z.boolean(),
    analysisParams: paramsSchema.nullable().default(null),
    transcript: transcriptSchema.nullable().default(null),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    let previousEnd = 0;
    for (const [index, s] of (p.transcript?.segments ?? []).entries()) {
      if (
        ids.has(s.id) ||
        s.startUs < previousEnd ||
        s.endUs > p.media.durationUs
      )
        ctx.addIssue({
          code: "custom",
          message: "文字段落时间或编号无效",
          path: ["transcript", "segments", index],
        });
      ids.add(s.id);
      previousEnd = s.endUs;
    }
  })
  .transform((p) => ({ ...p, version: 2 as const }));
export type Project = z.infer<typeof projectSchema>;
export type Loaded = {
  project: Project;
  waveform: number[];
  sourceUrl: string;
};
export type Progress = { stage: string; percent: number | null };
export type ExportKind =
  "mp4" | "premiere" | "resolve" | "fcpxml" | "jianying" | "srt";
export type ModelStatus = {
  ready: boolean;
  runtimeReady: boolean;
  name: string;
  bytes: number;
  hash: string | null;
};
export function cutCandidates(p: Project): Candidate[] {
  return [
    ...p.candidates,
    ...(p.transcript?.segments
      .filter((s) => s.remove)
      .map((s) => ({ ...s, id: `text:${s.id}` })) ?? []),
  ];
}
export const projectRanges = (p: Project) =>
  keepRanges(p.media, cutCandidates(p));
export const frameUs = (m: Pick<Media, "fpsNum" | "fpsDen">) =>
  (1e6 * m.fpsDen) / m.fpsNum;
export const totalFrames = (m: Media) =>
  Math.max(1, Math.round(m.durationUs / frameUs(m)));
export const frame = (us: number, m: Media) =>
  Math.min(totalFrames(m), Math.max(0, Math.round(us / frameUs(m))));
export function keepRanges(m: Media, cs: Candidate[]): Range[] {
  const removed = cs
    .filter((c) => c.remove)
    .map((c) => ({ a: frame(c.startUs, m), b: frame(c.endUs, m) }))
    .sort((a, b) => a.a - b.a);
  let cursor = 0;
  const out: Range[] = [];
  for (const r of removed) {
    if (r.a > cursor)
      out.push({
        startUs: Math.round(cursor * frameUs(m)),
        endUs: Math.round(r.a * frameUs(m)),
      });
    cursor = Math.max(cursor, r.b);
  }
  if (cursor < totalFrames(m))
    out.push({
      startUs: Math.round(cursor * frameUs(m)),
      endUs: Math.round(totalFrames(m) * frameUs(m)),
    });
  return out;
}
export function silenceCandidates(
  silences: Range[],
  durationUs: number,
  padding: number,
): Candidate[] {
  return silences
    .map((s, i) => ({
      id: String(i + 1),
      startUs: s.startUs === 0 ? 0 : Math.round(s.startUs + padding * 1e6),
      endUs:
        s.endUs >= durationUs
          ? durationUs
          : Math.round(s.endUs - padding * 1e6),
      remove: true,
    }))
    .filter((s) => s.endUs > s.startUs);
}
export const duration = (rs: Range[]) =>
  rs.reduce((s, r) => s + r.endUs - r.startUs, 0);
export const formatTime = (us: number, decimal = false) => {
  const s = decimal
    ? Math.round(Math.max(0, us) / 1e5) / 10
    : Math.floor(Math.max(0, us) / 1e6);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(decimal ? 1 : 0).padStart(decimal ? 4 : 2, "0")}`;
};
export function sourceToCut(us: number, rs: Range[]) {
  let t = 0;
  for (const r of rs) {
    if (us < r.startUs) return t;
    if (us < r.endUs) return t + us - r.startUs;
    t += r.endUs - r.startUs;
  }
  return t;
}
export function cutToSource(us: number, rs: Range[]) {
  for (const r of rs) {
    const d = r.endUs - r.startUs;
    if (us < d) return r.startUs + us;
    us -= d;
  }
  return rs.at(-1)?.endUs ?? 0;
}
