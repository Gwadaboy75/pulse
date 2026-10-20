// Life Dashboard Companion's webhook body (docs/webhook.md in that repo) -> one typed Payload. Pure, no I/O.
//
// The app sends only arrays with records in them, UTC ISO instants, doubles with a decimal point and integers
// without, and a bucketed series under the same key as its raw one ("bucket_start" in the object). Every record
// carries `uuid` (Health Connect's id; `<record>#<epoch ms>` for heart-rate and skin-temperature samples) and
// `source` (the writing app's package). Anything unreadable is skipped, never read as zero.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
const int = (v: unknown) => (num(v) === null ? null : Math.round(num(v)!));
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
/** Unix seconds of an ISO 8601 instant (any fraction length). */
function secs(v: unknown): number | null {
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
const isBucket = (o: Obj) => "bucket_start" in o;

/** What every record carries. `recordUuid` is the part before `#`: the Health Connect record a sample belongs to. */
export type Rec = { uuid: string; recordUuid: string; source: string | null };

export type HrSample = Rec & { ts: number; bpm: number };
export type HrBucket = { start: number; end: number; avg: number; n: number };
export type StepsInterval = Rec & { start: number; end: number; count: number };
export type StepsBucket = { start: number; end: number; total: number; complete: boolean };
export type Stage = "awake" | "light" | "deep" | "rem" | "sleeping" | "unknown";
export type SleepSession = Rec & { start: number; end: number; stages: { stage: Stage; start: number; end: number }[] };
export type ExerciseSession = Rec & { start: number; end: number; type: string; name: string | null; title: string | null };
/** hc_vitals kinds: the night's sampled vitals, the day's values, and body readings. */
export type VitalKind = "hrv" | "resp" | "spo2" | "skin_temp_delta" | "skin_temp_baseline" | "rhr" | "glucose" | "core_temp" | "weight" | "body_fat" | "vo2_max" | "height";
export type Vital = Rec & { kind: VitalKind; ts: number; value: number };
export type DailyTotal = { date: string; steps: number | null; distanceM: number | null; activeKcal: number | null; totalKcal: number | null };

export type Payload = {
  test: boolean;
  /** `health_connect`, `screen_time`, `healthkit_ios`, or null when absent. */
  source: string | null;
  timestamp: number | null;
  sequence: number | null;
  appVersion: string | null;
  timeZone: string | null;
  backfill: { start: number; end: number; complete: boolean } | null;
  dailyTotals: DailyTotal[];
  heartRate: { samples: HrSample[]; buckets: HrBucket[] };
  steps: { intervals: StepsInterval[]; buckets: StepsBucket[] };
  sleep: SleepSession[];
  exercise: ExerciseSession[];
  vitals: Vital[];
  deleted: { type: string; uuid: string }[];
  deletionsUnavailable: string[];
};

/** The instant-valued payload keys this source reads, with the hc_vitals kind each feeds and the unit factor to Pulse's. */
export const VITAL_KEYS: Record<string, { field: string; kind: VitalKind; scale?: number; positive?: boolean }> = {
  heart_rate_variability: { field: "heart_rate_variability_millis", kind: "hrv", positive: true },
  respiratory_rate: { field: "rate", kind: "resp", positive: true },
  oxygen_saturation: { field: "percentage", kind: "spo2", positive: true },
  resting_heart_rate: { field: "bpm", kind: "rhr", positive: true },
  // Health Connect stores mmol/L; Pulse's extra metric (and Google's roll-up) is mg/dL.
  blood_glucose: { field: "mmol_per_liter", kind: "glucose", scale: 18.016, positive: true },
  body_temperature: { field: "celsius", kind: "core_temp", positive: true },
  weight: { field: "kilograms", kind: "weight", positive: true },
  body_fat: { field: "percentage", kind: "body_fat", positive: true },
  vo2_max: { field: "vo2_ml_per_min_per_kg", kind: "vo2_max", positive: true },
  height: { field: "meters", kind: "height", scale: 100, positive: true },
};
/** Vital kinds whose night's mean goes to daily_metrics (sampled series); the others take the day's latest value. */
export const NIGHT_KINDS = new Set<VitalKind>(["hrv", "resp", "spo2", "skin_temp_delta", "skin_temp_baseline"]);

/** The payload key a deletion of each vital kind arrives under. */
export const KEY_OF_KIND: Record<VitalKind, string> = {
  hrv: "heart_rate_variability",
  resp: "respiratory_rate",
  spo2: "oxygen_saturation",
  skin_temp_delta: "skin_temperature",
  skin_temp_baseline: "skin_temperature",
  rhr: "resting_heart_rate",
  glucose: "blood_glucose",
  core_temp: "body_temperature",
  weight: "weight",
  body_fat: "body_fat",
  vo2_max: "vo2_max",
  height: "height",
};

function rec(o: Obj, fallback: string): Rec {
  const uuid = str(o.uuid) ?? fallback;
  return { uuid, recordUuid: uuid.split("#")[0], source: str(o.source) };
}

/** A measured series' bucket as one sample at the window start (its `avg`), keyed so a re-sent window lands on itself. */
function bucketSample(key: string, o: Obj): (Rec & { ts: number; value: number }) | null {
  const ts = secs(o.bucket_start);
  const avg = num(o.avg);
  if (ts === null || avg === null) return null;
  const uuid = `bucket:${key}:${ts}`;
  return { uuid, recordUuid: uuid, source: null, ts, value: avg };
}

const SLEEP_STAGES = new Set<Stage>(["awake", "light", "deep", "rem", "sleeping", "unknown"]);
/** Health Connect's awake-ish stages all count as awake for the hypnogram. */
const STAGE_ALIAS: Record<string, Stage> = { awake_in_bed: "awake", out_of_bed: "awake" };

/** Parses a decoded JSON body. Never throws on a strange shape: fields it cannot read are left empty. */
export function parsePayload(body: unknown): Payload {
  const b = isObj(body) ? body : {};
  const p: Payload = {
    test: b.test === true,
    source: str(b.source),
    timestamp: secs(b.timestamp),
    sequence: int(b.sequence),
    appVersion: str(b.app_version),
    timeZone: str(b.timezone),
    backfill: null,
    dailyTotals: [],
    heartRate: { samples: [], buckets: [] },
    steps: { intervals: [], buckets: [] },
    sleep: [],
    exercise: [],
    vitals: [],
    deleted: [],
    deletionsUnavailable: [],
  };
  if (b.backfill === true) {
    const start = secs(b.window_start);
    const end = secs(b.window_end);
    if (start !== null && end !== null && end > start) p.backfill = { start, end, complete: b.window_complete === true };
  }

  for (const t of list(b.daily_totals)) {
    if (!isObj(t)) continue;
    const date = str(t.date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const row = { date, steps: int(t.steps), distanceM: num(t.distance_meters), activeKcal: num(t.active_calories), totalKcal: num(t.total_calories) };
    if (row.steps !== null || row.distanceM !== null || row.activeKcal !== null || row.totalKcal !== null) p.dailyTotals.push(row);
  }

  for (const o of list(b.heart_rate)) {
    if (!isObj(o)) continue;
    if (isBucket(o)) {
      const [start, end, avg, n] = [secs(o.bucket_start), secs(o.bucket_end), num(o.avg), int(o.sample_count)];
      if (start !== null && end !== null && avg !== null && avg > 0) p.heartRate.buckets.push({ start, end, avg, n: n ?? 1 });
      continue;
    }
    const ts = secs(o.time);
    const bpm = int(o.bpm);
    if (ts !== null && bpm !== null && bpm > 0) p.heartRate.samples.push({ ...rec(o, `heart_rate#${ts}`), ts, bpm });
  }

  for (const o of list(b.steps)) {
    if (!isObj(o)) continue;
    const start = secs(isBucket(o) ? o.bucket_start : o.start_time);
    const end = secs(isBucket(o) ? o.bucket_end : o.end_time);
    if (start === null || end === null || end < start) continue;
    if (isBucket(o)) {
      const total = num(o.total);
      if (total !== null && total >= 0) p.steps.buckets.push({ start, end, total: Math.round(total), complete: o.complete === true });
      continue;
    }
    const count = int(o.count);
    if (count !== null && count > 0) p.steps.intervals.push({ ...rec(o, `steps-${start}`), start, end, count });
  }

  for (const o of list(b.sleep)) {
    if (!isObj(o)) continue;
    const end = secs(o.session_end_time);
    const dur = int(o.duration_seconds);
    if (end === null || dur === null || dur <= 0) continue;
    const start = end - dur;
    const stages: SleepSession["stages"] = [];
    for (const s of list(o.stages)) {
      if (!isObj(s)) continue;
      const raw = str(s.stage) ?? "unknown";
      const stage = STAGE_ALIAS[raw] ?? (SLEEP_STAGES.has(raw as Stage) ? (raw as Stage) : "unknown");
      const sStart = secs(s.start_time);
      const sEnd = secs(s.end_time);
      if (sStart !== null && sEnd !== null && sEnd > sStart) stages.push({ stage, start: sStart, end: sEnd });
    }
    stages.sort((a, z) => a.start - z.start);
    p.sleep.push({ ...rec(o, `sleep-${start}`), start, end, stages });
  }

  for (const o of list(b.exercise)) {
    if (!isObj(o)) continue;
    const start = secs(o.start_time);
    const end = secs(o.end_time);
    if (start === null || end === null || end < start) continue;
    p.exercise.push({ ...rec(o, `exercise-${start}`), start, end, type: str(o.type) ?? "0", name: str(o.name), title: str(o.title) });
  }

  for (const [key, { field, kind, scale = 1, positive }] of Object.entries(VITAL_KEYS)) {
    for (const o of list(b[key])) {
      if (!isObj(o)) continue;
      if (isBucket(o)) {
        const s = bucketSample(key, o);
        if (s && (!positive || s.value > 0)) p.vitals.push({ ...s, kind, value: s.value * scale });
        continue;
      }
      const ts = secs(o.time);
      const v = num(o[field]);
      if (ts !== null && v !== null && (!positive || v > 0)) p.vitals.push({ ...rec(o, `${key}-${ts}`), kind, ts, value: v * scale });
    }
  }
  for (const o of list(b.skin_temperature)) {
    if (!isObj(o)) continue;
    if (isBucket(o)) {
      const s = bucketSample("skin_temperature", o);
      if (s) p.vitals.push({ ...s, kind: "skin_temp_delta" });
      continue;
    }
    const ts = secs(o.time);
    const delta = num(o.delta_celsius);
    if (ts === null || delta === null) continue;
    const r = rec(o, `skin_temperature#${ts}`);
    p.vitals.push({ ...r, kind: "skin_temp_delta", ts, value: delta });
    const base = num(o.baseline_celsius);
    if (base !== null) p.vitals.push({ ...r, kind: "skin_temp_baseline", ts, value: base });
  }

  for (const d of list(b.deleted_records)) {
    if (!isObj(d)) continue;
    const type = str(d.type);
    const uuid = str(d.uuid);
    if (type && uuid) p.deleted.push({ type, uuid });
  }
  for (const t of list(b.deletions_unavailable)) if (typeof t === "string" && t) p.deletionsUnavailable.push(t);
  return p;
}
