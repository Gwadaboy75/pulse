// Pure mappers: a parsed Health Connect payload -> rows for the normalized tables, in the shapes the Google
// mappers produce (sources/google/map.ts), so the pipeline reads both sources alike. No I/O.
import type { exercises, sleepSessions } from "../../db/schema";
import { localDay } from "../../time";
import type { HrBucket, Payload, SleepSession, StepsBucket, StepsInterval } from "./parse";

/** A record's span and writer, for hc_records. */
export type Span = { uuid: string; start: number; end: number; source: string | null };

// --- Intraday -------------------------------------------------------------------------------------

/**
 * Band heart rate, unix second -> bpm. A bucket (the app's 1m/5m/15m/1h resolution) is one sample at its start, the
 * window's mean; stage 1 reads per-minute means on older days anyway. A repeated second keeps the last sample.
 * Also the records the samples belong to (`<record>#<ms>` uuids share a record), each with the span its samples cover.
 */
export function mapHeartRate(p: Payload): { samples: Map<number, number>; records: Span[] } {
  const samples = new Map<number, number>();
  const spans = new Map<string, Span>();
  for (const s of p.heartRate.samples) {
    samples.set(s.ts, s.bpm);
    const r = spans.get(s.recordUuid);
    if (r) {
      r.start = Math.min(r.start, s.ts);
      r.end = Math.max(r.end, s.ts);
    } else spans.set(s.recordUuid, { uuid: s.recordUuid, start: s.ts, end: s.ts, source: s.source });
  }
  for (const b of p.heartRate.buckets) samples.set(b.start, Math.round(b.avg));
  return { samples, records: [...spans.values()] };
}

/** Steps spread evenly over the minutes an interval touches (minute-start unix second -> count). */
function spread(into: Map<number, number>, start: number, end: number, n: number) {
  const first = Math.floor(start / 60);
  const minutes = Math.max(1, Math.ceil(end / 60) - first);
  for (let i = 0; i < minutes; i++) {
    const share = Math.floor((n * (i + 1)) / minutes) - Math.floor((n * i) / minutes);
    const ts = (first + i) * 60;
    into.set(ts, (into.get(ts) ?? 0) + share);
  }
}

/**
 * Steps per minute. Raw intervals are the maximum across writing apps per minute (the phone and the band both
 * count a walk) and merge with "max"; a complete bucket holds every record of its window, so it is written as-is
 * ("set"), an incomplete one merges with "max" too.
 */
export function mapSteps(p: Payload): { max: Map<number, number>; set: Map<number, number>; records: Span[] } {
  const bySource = new Map<string, Map<number, number>>();
  const records: Span[] = [];
  for (const i of p.steps.intervals) {
    const mine = bySource.get(i.source ?? "") ?? bySource.set(i.source ?? "", new Map()).get(i.source ?? "")!;
    spread(mine, i.start, i.end, i.count);
    records.push({ uuid: i.uuid, start: i.start, end: i.end, source: i.source });
  }
  const max = new Map<number, number>();
  for (const mine of bySource.values()) for (const [ts, n] of mine) max.set(ts, Math.max(max.get(ts) ?? 0, n));
  const set = new Map<number, number>();
  for (const b of p.steps.buckets) spread(b.complete ? set : max, b.start, b.end, b.total);
  return { max, set, records };
}

export type { HrBucket, StepsBucket, StepsInterval };

// --- Sessions -------------------------------------------------------------------------------------

export type SessionRow = Omit<typeof sleepSessions.$inferInsert, "userId" | "isMain">;
export type SegmentRow = { sessionId: string; startTs: number; endTs: number; stage: "awake" | "light" | "deep" | "rem" };
export type ExerciseRow = Omit<typeof exercises.$inferInsert, "userId">;

const STAGED = new Set(["light", "deep", "rem"]);

/**
 * Sleep sessions on their local wake day, with their stage segments. `is_main` is not decided here: the day's
 * longest stored session wins, which the writer settles against what the table already holds.
 *
 * Health Connect's `sleeping` (a session without staging, as older Fitbit "classic" nights) and `unknown` count as
 * asleep in the summary but draw no segment; a session whose stages name light, deep or REM is `SUCCEEDED`, so
 * Recovery reads its night; any other staged session is `UNSTAGED` and keeps its minutes.
 */
export function mapSleep(sessions: SleepSession[], tz: string): { sessions: SessionRow[]; segments: SegmentRow[] } {
  const rows = new Map<string, SessionRow>();
  const segments: SegmentRow[] = [];
  for (const s of sessions) {
    const mins = { awake: 0, light: 0, deep: 0, rem: 0, sleeping: 0, unknown: 0 };
    const segs = new Map<number, SegmentRow>();
    for (const st of s.stages) {
      mins[st.stage] += (st.end - st.start) / 60;
      if (st.stage === "sleeping" || st.stage === "unknown") continue;
      segs.set(st.start, { sessionId: s.uuid, startTs: st.start, endTs: st.end, stage: st.stage });
    }
    const staged = s.stages.some((st) => STAGED.has(st.stage));
    const asleep = s.stages.length ? mins.light + mins.deep + mins.rem + mins.sleeping + mins.unknown : (s.end - s.start) / 60;
    rows.set(s.uuid, {
      id: s.uuid,
      day: localDay(s.end, tz),
      startTs: s.start,
      endTs: s.end,
      processed: true,
      stagesStatus: staged ? "SUCCEEDED" : s.stages.length ? "UNSTAGED" : null,
      asleepMin: Math.round(asleep),
      awakeMin: Math.round(mins.awake),
      deepMin: staged ? Math.round(mins.deep) : null,
      lightMin: staged ? Math.round(mins.light) : null,
      remMin: staged ? Math.round(mins.rem) : null,
      source: s.source ?? "health_connect",
    });
    if (staged) segments.push(...[...segs.values()].sort((a, z) => a.startTs - z.startTs));
  }
  return { sessions: [...rows.values()], segments };
}

/**
 * Exercises on their local start day. `type` is Health Connect's lower-case name upper-cased (`running` ->
 * `RUNNING`, `strength_training` -> `STRENGTH_TRAINING`), the vocabulary the activity kinds and Pulse Age's strength
 * term already match on; a type the app has no name for keeps its number (`EXERCISE_57`).
 */
export function mapExercises(p: Payload, tz: string): ExerciseRow[] {
  const out = new Map<string, ExerciseRow>();
  for (const e of p.exercise) {
    out.set(e.uuid, {
      id: e.uuid,
      day: localDay(e.start, tz),
      startTs: e.start,
      endTs: e.end,
      type: (e.name ?? `exercise_${e.type}`).toUpperCase(),
      name: e.title,
      calories: null,
      distanceM: null,
      source: e.source ?? "health_connect",
    });
  }
  return [...out.values()];
}
