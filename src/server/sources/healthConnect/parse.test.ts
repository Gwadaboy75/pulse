import { describe, expect, it } from "vitest";
import { mapExercises, mapHeartRate, mapSleep, mapSteps } from "./map";
import { parsePayload } from "./parse";

const TZ = "Europe/Paris";
const t = (s: string) => Math.floor(Date.parse(s) / 1000);

const body = {
  timestamp: "2026-10-04T07:15:02.481Z",
  app_version: "1.23.0",
  source: "health_connect",
  sequence: 1842,
  timezone: TZ,
  daily_totals: [{ date: "2026-10-04", steps: 1204, distance_meters: 911.6, active_calories: 58.2, total_calories: 702.9 }],
  steps: [{ count: 120, start_time: "2026-10-04T06:00:00Z", end_time: "2026-10-04T06:02:00Z", uuid: "s1", source: "com.fitbit.FitbitMobile" }],
  heart_rate: [
    { bpm: 61, time: "2026-10-04T06:58:00Z", uuid: "hr1#1791097080000", source: "com.fitbit.FitbitMobile" },
    { bpm: 63, time: "2026-10-04T06:58:05Z", uuid: "hr1#1791097085000", source: "com.fitbit.FitbitMobile" },
    { bpm: 0, time: "2026-10-04T06:58:10Z", uuid: "hr1#1791097090000" },
  ],
  heart_rate_variability: [{ heart_rate_variability_millis: 42.5, time: "2026-10-04T03:10:00Z", uuid: "v1" }],
  respiratory_rate: [{ rate: 15.5, time: "2026-10-04T03:00:00Z", uuid: "r1" }],
  skin_temperature: [{ delta_celsius: -0.3, baseline_celsius: 33.5, time: "2026-10-04T03:10:00Z", uuid: "st#1791083400000" }],
  blood_glucose: [{ mmol_per_liter: 5.5, time: "2026-10-04T07:00:00Z", uuid: "g1" }],
  weight: [{ kilograms: 75.5, time: "2026-10-04T07:00:00Z", uuid: "w1" }],
  height: [{ meters: 1.82, time: "2026-10-04T07:00:00Z", uuid: "h1" }],
  sleep: [
    {
      session_end_time: "2026-10-04T06:30:00Z",
      duration_seconds: 7200,
      uuid: "sl1",
      source: "com.fitbit.FitbitMobile",
      stages: [
        { stage: "light", start_time: "2026-10-04T04:30:00Z", end_time: "2026-10-04T05:00:00Z", duration_seconds: 1800 },
        { stage: "deep", start_time: "2026-10-04T05:00:00Z", end_time: "2026-10-04T05:30:00Z", duration_seconds: 1800 },
        { stage: "awake_in_bed", start_time: "2026-10-04T05:30:00Z", end_time: "2026-10-04T05:40:00Z", duration_seconds: 600 },
        { stage: "rem", start_time: "2026-10-04T05:40:00Z", end_time: "2026-10-04T06:30:00Z", duration_seconds: 3000 },
      ],
    },
    { session_end_time: "2026-10-03T22:00:00Z", duration_seconds: 1800, uuid: "nap", stages: [{ stage: "sleeping", start_time: "2026-10-03T21:30:00Z", end_time: "2026-10-03T22:00:00Z", duration_seconds: 1800 }] },
  ],
  exercise: [{ type: "70", name: "strength_training", title: "Leg day", start_time: "2026-10-04T17:00:00Z", end_time: "2026-10-04T17:40:00Z", duration_seconds: 2400, uuid: "ex1" }],
  deleted_records: [{ type: "sleep", uuid: "old-night" }],
  deletions_unavailable: ["hydration"],
};

describe("parsePayload", () => {
  it("reads the envelope and every record type, skipping what it cannot read", () => {
    const p = parsePayload(body);
    expect(p).toMatchObject({ test: false, source: "health_connect", sequence: 1842, appVersion: "1.23.0", timeZone: TZ, backfill: null });
    expect(p.dailyTotals).toEqual([{ date: "2026-10-04", steps: 1204, distanceM: 911.6, activeKcal: 58.2, totalKcal: 702.9 }]);
    expect(p.heartRate.samples.map((s) => s.bpm)).toEqual([61, 63]); // the 0 bpm sample is dropped
    expect(p.heartRate.samples[0]).toMatchObject({ uuid: "hr1#1791097080000", recordUuid: "hr1", source: "com.fitbit.FitbitMobile" });
    expect(p.steps.intervals[0]).toMatchObject({ count: 120, start: t("2026-10-04T06:00:00Z"), end: t("2026-10-04T06:02:00Z") });
    expect(p.vitals.map((v) => [v.kind, v.value])).toEqual([
      ["hrv", 42.5],
      ["resp", 15.5],
      ["glucose", 5.5 * 18.016],
      ["weight", 75.5],
      ["height", 182],
      ["skin_temp_delta", -0.3],
      ["skin_temp_baseline", 33.5],
    ]);
    expect(p.vitals.find((v) => v.kind === "skin_temp_delta")).toMatchObject({ recordUuid: "st", ts: t("2026-10-04T03:10:00Z") });
    expect(p.sleep[0]).toMatchObject({ uuid: "sl1", start: t("2026-10-04T04:30:00Z"), end: t("2026-10-04T06:30:00Z") });
    expect(p.sleep[0].stages.map((s) => s.stage)).toEqual(["light", "deep", "awake", "rem"]);
    expect(p.exercise[0]).toMatchObject({ uuid: "ex1", type: "70", name: "strength_training", title: "Leg day" });
    expect(p.deleted).toEqual([{ type: "sleep", uuid: "old-night" }]);
    expect(p.deletionsUnavailable).toEqual(["hydration"]);
  });

  it("test pings, backfill windows and bucketed series", () => {
    expect(parsePayload({ test: true, message: "hi", source: "health_connect" })).toMatchObject({ test: true, sequence: null });
    const p = parsePayload({
      source: "health_connect",
      sequence: 9,
      backfill: true,
      window_start: "2026-09-01T07:15:02Z",
      window_end: "2026-09-04T07:15:02Z",
      window_complete: true,
      heart_rate: [{ bucket_start: "2026-09-01T08:00:00Z", bucket_end: "2026-09-01T08:01:00Z", sample_count: 58, avg: 72.4, min: 66.0, max: 81.0 }],
      steps: [{ bucket_start: "2026-09-01T08:00:00Z", bucket_end: "2026-09-01T09:00:00Z", sample_count: 12, total: 1840.0, complete: true }],
      heart_rate_variability: [{ bucket_start: "2026-09-01T03:00:00Z", bucket_end: "2026-09-01T03:15:00Z", sample_count: 3, avg: 40.0, min: 38, max: 42 }],
    });
    expect(p.backfill).toEqual({ start: t("2026-09-01T07:15:02Z"), end: t("2026-09-04T07:15:02Z"), complete: true });
    expect(p.heartRate.buckets).toEqual([{ start: t("2026-09-01T08:00:00Z"), end: t("2026-09-01T08:01:00Z"), avg: 72.4, n: 58 }]);
    expect(p.steps.buckets).toEqual([{ start: t("2026-09-01T08:00:00Z"), end: t("2026-09-01T09:00:00Z"), total: 1840, complete: true }]);
    const ts = t("2026-09-01T03:00:00Z");
    expect(p.vitals).toEqual([{ uuid: `bucket:heart_rate_variability:${ts}`, recordUuid: `bucket:heart_rate_variability:${ts}`, source: null, kind: "hrv", ts, value: 40 }]);
    expect(parsePayload(null).sleep).toEqual([]);
    expect(parsePayload({ sleep: [{ session_end_time: "x", duration_seconds: 10 }] }).sleep).toEqual([]);
  });
});

describe("mappers", () => {
  const p = parsePayload(body);

  it("heart rate: samples by second, a bucket as one rounded sample, records with the span their samples cover", () => {
    const { samples, records } = mapHeartRate(p);
    expect([...samples]).toEqual([
      [t("2026-10-04T06:58:00Z"), 61],
      [t("2026-10-04T06:58:05Z"), 63],
    ]);
    expect(records).toEqual([{ uuid: "hr1", start: t("2026-10-04T06:58:00Z"), end: t("2026-10-04T06:58:05Z"), source: "com.fitbit.FitbitMobile" }]);
    const b = mapHeartRate({ ...p, heartRate: { samples: [], buckets: [{ start: 60, end: 120, avg: 72.4, n: 58 }] } });
    expect([...b.samples]).toEqual([[60, 72]]);
  });

  it("steps: an interval spread over its minutes (max across sources), a complete bucket written as-is", () => {
    const { max, set, records } = mapSteps(p);
    expect([...max]).toEqual([
      [t("2026-10-04T06:00:00Z"), 60],
      [t("2026-10-04T06:01:00Z"), 60],
    ]);
    expect(set.size).toBe(0);
    expect(records[0]).toMatchObject({ uuid: "s1" });
    const two = mapSteps({ ...p, steps: { intervals: [...p.steps.intervals, { ...p.steps.intervals[0], uuid: "s2", source: "com.other", count: 200 }], buckets: [{ start: 3600, end: 7200, total: 600, complete: true }] } });
    expect([...two.max].map(([, n]) => n)).toEqual([100, 100]); // the larger source, never the sum
    expect([...two.set].length).toBe(60);
    expect([...two.set].reduce((a, [, n]) => a + n, 0)).toBe(600);
  });

  it("sleep: the wake day, staged minutes, awake-ish stages as awake, a classic night as unstaged", () => {
    const { sessions, segments } = mapSleep(p.sleep, TZ);
    const night = sessions.find((s) => s.id === "sl1")!;
    expect(night).toMatchObject({ day: "2026-10-04", processed: true, stagesStatus: "SUCCEEDED", asleepMin: 110, awakeMin: 10, deepMin: 30, lightMin: 30, remMin: 50, source: "com.fitbit.FitbitMobile" });
    expect(segments.filter((s) => s.sessionId === "sl1").map((s) => s.stage)).toEqual(["light", "deep", "awake", "rem"]);
    const nap = sessions.find((s) => s.id === "nap")!;
    expect(nap).toMatchObject({ day: "2026-10-04", stagesStatus: "UNSTAGED", asleepMin: 30, awakeMin: 0, deepMin: null, source: "health_connect" });
    expect(segments.some((s) => s.sessionId === "nap")).toBe(false);
  });

  it("exercise: the start day and Health Connect's name upper-cased, the title as the name", () => {
    expect(mapExercises(p, TZ)).toEqual([
      { id: "ex1", day: "2026-10-04", startTs: t("2026-10-04T17:00:00Z"), endTs: t("2026-10-04T17:40:00Z"), type: "STRENGTH_TRAINING", name: "Leg day", calories: null, distanceM: null, source: "health_connect" },
    ]);
    expect(mapExercises({ ...p, exercise: [{ ...p.exercise[0], name: null, type: "57" }] }, TZ)[0].type).toBe("EXERCISE_57");
  });
});
