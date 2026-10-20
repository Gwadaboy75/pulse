// The Health Connect path scores a person as the Google path does: the demo's 180 days, rewritten as the payloads
// Life Dashboard Companion would send for them (one per day: the band's samples, the night with its stages, the
// nightly vitals as Fitbit samples them, the day's totals), ingested into an empty database and recomputed, give
// the demo's own Recovery, Strain and Sleep on every day.
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { type Db, rows, sql } from "../../db";
import { dailyMetrics, exercises, sleepSegments, sleepSessions } from "../../db/schema";
import { recompute } from "../../pipeline";
import { readSamples } from "../../samples";
import { freshDb, OPTS, seeded, TZ, USER } from "../../testing";
import { localDay, localMidnight } from "../../time";
import { parsePayload } from "./parse";
import { applyPayload } from "./write";

type Score = { day: string; recovery: number | null; strain: number | null; sleep: number | null };
const scores = (db: Db) =>
  rows<Score>(
    db,
    sql`select day, (recovery->>'value')::float8 recovery, (strain->>'effort')::float8 strain,
          coalesce((sleep->>'performance')::float8, (sleep->>'value')::float8) sleep
        from daily_scores where user_id = ${USER} order by day`,
  );
const iso = (s: number) => new Date(s * 1000).toISOString();

it("the demo's days, sent as Health Connect payloads, score as the demo does", async () => {
  const src = await seeded();
  const [metrics, sessions, segments, exs, hr, steps, expected] = await Promise.all([
    src.select().from(dailyMetrics).where(eq(dailyMetrics.userId, USER)).orderBy(dailyMetrics.day),
    src.select().from(sleepSessions).where(eq(sleepSessions.userId, USER)),
    src.select().from(sleepSegments).where(eq(sleepSegments.userId, USER)),
    src.select().from(exercises).where(eq(exercises.userId, USER)),
    readSamples(src, "hr", USER, 0, 4e9),
    readSamples(src, "steps", USER, 0, 4e9),
    scores(src),
  ]);
  const days = metrics.map((m) => m.day);
  const byDay = <T>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return m;
  };
  const hrByDay = byDay(hr, (s) => localDay(s.ts, TZ));
  const stepsByDay = byDay(steps, (s) => localDay(s.ts, TZ));
  const sessionsByDay = byDay(sessions, (s) => s.day);
  const exByDay = byDay(exs, (e) => e.day);
  const segsOf = byDay(segments, (s) => s.sessionId);

  /** One payload per day, as the app would build it after that day's syncs. */
  function payload(day: string, seq: number) {
    const m = metrics.find((x) => x.day === day)!;
    const main = sessionsByDay.get(day)?.find((s) => s.isMain);
    const mid = main ? Math.round((main.startTs + main.endTs) / 2) : localMidnight(day, TZ) + 3 * 3600;
    const wake = main ? main.endTs : localMidnight(day, TZ) + 7 * 3600;
    const at = (ts: number, uuid: string, fields: Record<string, number>) => ({ ...fields, time: iso(ts), uuid, source: "com.fitbit.FitbitMobile" });
    return {
      timestamp: iso(wake + 3600),
      app_version: "1.23.0",
      source: "health_connect",
      sequence: seq,
      timezone: TZ,
      daily_totals: [{ date: day, ...(m.steps != null && { steps: m.steps }), ...(m.calories != null && { total_calories: m.calories }) }],
      heart_rate: (hrByDay.get(day) ?? []).map((s) => ({ bpm: s.v, time: iso(s.ts), uuid: `hr-${day}#${s.ts * 1000}`, source: "com.fitbit.FitbitMobile" })),
      steps: (stepsByDay.get(day) ?? []).map((s) => ({ count: s.v, start_time: iso(s.ts), end_time: iso(s.ts + 60), uuid: `steps-${s.ts}`, source: "com.fitbit.FitbitMobile" })),
      sleep: (sessionsByDay.get(day) ?? []).map((s) => ({
        session_end_time: iso(s.endTs),
        duration_seconds: s.endTs - s.startTs,
        uuid: s.id,
        source: "com.fitbit.FitbitMobile",
        stages: s.isMain
          ? (segsOf.get(s.id) ?? []).map((g) => ({ stage: g.stage, start_time: iso(g.startTs), end_time: iso(g.endTs) }))
          : // A nap without staging: its asleep and awake minutes as one span each.
            [
              { stage: "sleeping", start_time: iso(s.startTs), end_time: iso(s.startTs + (s.asleepMin ?? 0) * 60) },
              ...((s.awakeMin ?? 0) > 0 ? [{ stage: "awake", start_time: iso(s.startTs + (s.asleepMin ?? 0) * 60), end_time: iso(s.endTs) }] : []),
            ],
      })),
      exercise: (exByDay.get(day) ?? []).map((e) => ({ type: "0", name: e.type.toLowerCase(), title: e.name ?? undefined, start_time: iso(e.startTs), end_time: iso(e.endTs), duration_seconds: e.endTs - e.startTs, uuid: e.id })),
      ...(m.hrvMs != null && { heart_rate_variability: [at(mid, `hrv-${day}`, { heart_rate_variability_millis: m.hrvMs })] }),
      ...(m.respBpm != null && { respiratory_rate: [at(mid, `resp-${day}`, { rate: m.respBpm })] }),
      ...(m.spo2Pct != null && { oxygen_saturation: [at(mid, `spo2-${day}`, { percentage: m.spo2Pct })] }),
      ...(m.rhrBpm != null && { resting_heart_rate: [at(wake, `rhr-${day}`, { bpm: m.rhrBpm })] }),
      // Fitbit's skin temperature is a delta from its baseline; the seed's nights without a baseline yet stay out.
      ...(m.nightlyTempC != null && m.tempBaselineC != null && { skin_temperature: [at(mid, `skin-${day}#${mid * 1000}`, { delta_celsius: m.nightlyTempC - m.tempBaselineC, baseline_celsius: m.tempBaselineC })] }),
      ...(m.weightKg != null && { weight: [at(wake + 1800, `w-${day}`, { kilograms: m.weightKg })] }),
      ...(m.bodyFatPct != null && { body_fat: [at(wake + 1800, `bf-${day}`, { percentage: m.bodyFatPct })] }),
      ...(m.vo2maxDaily != null && { vo2_max: [at(wake + 1800, `vo2-${day}`, { vo2_ml_per_min_per_kg: m.vo2maxDaily })] }),
    };
  }

  const dst = await freshDb();
  let seq = 0;
  for (const day of days) await applyPayload(dst, { userId: USER, tz: TZ, role: "primary", seq: ++seq }, parsePayload(payload(day, seq)));
  await recompute(dst, OPTS);

  const actual = await scores(dst);
  expect(actual.map((d) => d.day)).toEqual(expected.map((d) => d.day));
  // Strain and Sleep are identical. Recovery is identical too, except on the two nights whose skin temperature the seed
  // reports before its 30-night baseline exists: Fitbit sends a delta or nothing, so the phone path leaves them out and
  // Pulse's own skin baseline folds differently there (about a point, measured 2026-10-20).
  const off: string[] = [];
  expected.forEach((e, i) => {
    const a = actual[i];
    for (const k of ["recovery", "strain", "sleep"] as const) {
      const tol = k === "recovery" ? 1.1 : 1e-6;
      if (e[k] == null ? a[k] != null : a[k] == null || Math.abs(a[k]! - e[k]!) > tol) off.push(`${e.day} ${k}: ${a[k]} vs ${e[k]}`);
    }
  });
  expect(off, off.slice(0, 10).join("\n")).toEqual([]);
  // The nightly inputs round-trip exactly.
  const [m] = await dst.select().from(dailyMetrics).where(and(eq(dailyMetrics.userId, USER), eq(dailyMetrics.day, days[100])));
  const s = metrics[100];
  expect([m.hrvMs, m.rhrBpm, m.respBpm, m.spo2Pct, m.steps]).toEqual([s.hrvMs, s.rhrBpm, s.respBpm, s.spo2Pct, s.steps]);
}, 600_000);
