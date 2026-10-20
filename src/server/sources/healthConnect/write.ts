// Writes one parsed Health Connect payload into the normalized tables, inside the caller's transaction.
//
// Provenance (hc_records) settles order: a record is written when no newer payload wrote or deleted it, so a payload
// that waited in the phone's outbox adds what it alone holds and never resurrects a night Fitbit has since rewritten.
// Every day a write touches is marked dirty, as the Google source does, and the nightly vitals of every touched day
// are rederived from hc_vitals, so a payload or a deletion leaves daily_metrics consistent either way.
//
// Role: `primary` writes everything; `fill` (beside a live Google grant) writes only the vitals and body readings,
// and only into daily_metrics columns Google left empty.
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../../db";
import { dailyMetrics, dailyValues, exercises, hcRecords, hcVitals, intradayDirty, sleepSegments, sleepSessions } from "../../db/schema";
import { mergeSamples } from "../../samples";
import { addDays, localDay, localMidnight } from "../../time";
import { upsert } from "../google/sync";
import { mapExercises, mapHeartRate, mapSleep, mapSteps, type SegmentRow, type Span } from "./map";
import { KEY_OF_KIND, NIGHT_KINDS, type Payload, type VitalKind } from "./parse";

export type Role = "primary" | "fill";
export type ApplyOptions = {
  userId: number;
  tz: string;
  role: Role;
  /** The payload's sequence; a payload without one (an old app) applies as the newest. */
  seq: number;
  /** A complete backfill window: records in it that no payload from `beforeSeq` on re-sent are gone from the phone. */
  prune?: { start: number; end: number; beforeSeq: number } | null;
};

/** What daily_metrics source column says for rows the phone wrote. */
export const SOURCE = "health_connect";
const CHUNK = 1000;
/** Without a main sleep session yet, the night's vitals are read from 18:00 the evening before to noon. */
const NIGHT_FALLBACK = { before: 6 * 3600, after: 12 * 3600 };

type Prov = { uuid: string; startTs: number; endTs: number; day: string; seenSeq: number; deletedSeq: number | null };

/** The record types a complete backfill window vouches for (never heart rate or steps: the phone resends those as deltas). */
const PRUNABLE = new Set(["sleep", "exercise", ...new Set(Object.values(KEY_OF_KIND))]);

export async function applyPayload(db: Db, o: ApplyOptions, p: Payload): Promise<boolean> {
  const { userId, tz, seq } = o;
  const dirty = new Set<string>();
  /** Days whose nightly and daily values are rederived from hc_vitals at the end. */
  const refresh = new Set<string>();
  /** Days whose main sleep session is re-settled. */
  const mainDays = new Set<string>();
  const dayOf = (ts: number) => localDay(ts, tz);

  async function provenance(type: string, uuids: string[]): Promise<Map<string, Prov>> {
    const out = new Map<string, Prov>();
    for (let i = 0; i < uuids.length; i += CHUNK) {
      const rows = await db
        .select({ uuid: hcRecords.uuid, startTs: hcRecords.startTs, endTs: hcRecords.endTs, day: hcRecords.day, seenSeq: hcRecords.seenSeq, deletedSeq: hcRecords.deletedSeq })
        .from(hcRecords)
        .where(and(eq(hcRecords.userId, userId), eq(hcRecords.type, type), inArray(hcRecords.uuid, uuids.slice(i, i + CHUNK))));
      for (const r of rows) out.set(r.uuid, r);
    }
    return out;
  }
  /** Whether this payload may write a record: nothing newer wrote or deleted it. */
  const admit = (prov: Map<string, Prov>, uuid: string) => {
    const r = prov.get(uuid);
    return !r || ((r.deletedSeq === null || r.deletedSeq <= seq) && r.seenSeq <= seq);
  };
  /** Records this payload wrote, keyed by what it saw; a span grows to cover every payload's samples. */
  async function record(type: string, spans: Span[], prov: Map<string, Prov>) {
    const rows = spans.map((s) => {
      const r = prov.get(s.uuid);
      const startTs = r ? Math.min(r.startTs, s.start) : s.start;
      const endTs = r ? Math.max(r.endTs, s.end) : s.end;
      return { userId, type, uuid: s.uuid, startTs, endTs, day: dayOf(type === "sleep" ? endTs : startTs), sourcePkg: s.source, seenSeq: Math.max(seq, r?.seenSeq ?? seq), deletedSeq: null };
    });
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(hcRecords)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [hcRecords.userId, hcRecords.type, hcRecords.uuid],
          set: { startTs: sql`excluded.start_ts`, endTs: sql`excluded.end_ts`, day: sql`excluded.day`, sourcePkg: sql`excluded.source_pkg`, seenSeq: sql`excluded.seen_seq`, deletedSeq: null },
        });
    }
  }

  /** Removes records the phone says are gone (or a backfill no longer carries), unless a newer payload wrote them since. */
  async function remove(items: { type: string; uuid: string }[]) {
    const byType = new Map<string, string[]>();
    for (const d of items) byType.set(d.type, [...(byType.get(d.type) ?? []), d.uuid]);
    for (const [type, uuids] of byType) {
      const prov = await provenance(type, uuids);
      const gone = uuids.map((u) => prov.get(u)).filter((r): r is Prov => !!r && r.deletedSeq === null && r.seenSeq <= seq);
      if (!gone.length) continue;
      const ids = gone.map((r) => r.uuid);
      switch (type) {
        case "sleep":
          await db.delete(sleepSessions).where(and(eq(sleepSessions.userId, userId), inArray(sleepSessions.id, ids)));
          for (const r of gone) {
            dirty.add(r.day);
            mainDays.add(r.day);
            refresh.add(r.day);
          }
          break;
        case "exercise":
          await db.delete(exercises).where(and(eq(exercises.userId, userId), inArray(exercises.id, ids)));
          for (const r of gone) dirty.add(r.day);
          break;
        case "heart_rate":
        case "steps":
          // ponytail: the window is cleared whole, so another app's samples in the same minutes go with it.
          for (const r of gone) for (const ts of await mergeSamples(db, type === "heart_rate" ? "hr" : "steps", userId, { start: r.startTs, end: r.endTs + 1 }, new Map(), "replace")) dirty.add(dayOf(ts));
          break;
        default:
          if (!PRUNABLE.has(type)) continue; // daily_totals and types this source never stored
          await db.delete(hcVitals).where(and(eq(hcVitals.userId, userId), inArray(hcVitals.recordUuid, ids)));
          for (const r of gone) {
            refresh.add(dayOf(r.startTs));
            refresh.add(addDays(dayOf(r.startTs), 1));
          }
      }
      await db
        .update(hcRecords)
        .set({ deletedSeq: seq })
        .where(and(eq(hcRecords.userId, userId), eq(hcRecords.type, type), inArray(hcRecords.uuid, ids)));
    }
  }

  // ── Deletions and backfill pruning ──────────────────────────────────────────
  await remove(p.deleted);
  if (o.prune) {
    const stale = await db
      .select({ type: hcRecords.type, uuid: hcRecords.uuid })
      .from(hcRecords)
      .where(
        and(
          eq(hcRecords.userId, userId),
          inArray(hcRecords.type, [...PRUNABLE]),
          gte(hcRecords.startTs, o.prune.start),
          lt(hcRecords.startTs, o.prune.end),
          lt(hcRecords.seenSeq, o.prune.beforeSeq),
          isNull(hcRecords.deletedSeq),
        ),
      );
    await remove(stale);
  }

  if (o.role === "primary") {
    // ── Heart rate ────────────────────────────────────────────────────────────
    {
      const prov = await provenance("heart_rate", [...new Set(p.heartRate.samples.map((s) => s.recordUuid))]);
      const { samples, records } = mapHeartRate({ ...p, heartRate: { samples: p.heartRate.samples.filter((s) => admit(prov, s.recordUuid)), buckets: p.heartRate.buckets } });
      if (samples.size) {
        for (const ts of await mergeSamples(db, "hr", userId, span(samples), samples, "set")) dirty.add(dayOf(ts));
        await record("heart_rate", records, prov);
      }
    }
    // ── Steps ─────────────────────────────────────────────────────────────────
    {
      const prov = await provenance("steps", p.steps.intervals.map((i) => i.uuid));
      const { max, set, records } = mapSteps({ ...p, steps: { intervals: p.steps.intervals.filter((i) => admit(prov, i.uuid)), buckets: p.steps.buckets } });
      if (max.size) for (const ts of await mergeSamples(db, "steps", userId, span(max), max, "max")) dirty.add(dayOf(ts));
      if (set.size) for (const ts of await mergeSamples(db, "steps", userId, span(set), set, "set")) dirty.add(dayOf(ts));
      if (records.length) await record("steps", records, prov);
    }
    // ── Daily totals: the phone's deduplicated day figures, newest payload wins ──
    {
      const prov = await provenance("daily_totals", p.dailyTotals.map((t) => t.date));
      const totals = p.dailyTotals.filter((t) => admit(prov, t.date));
      const metricRows = totals
        .filter((t) => t.steps !== null || t.totalKcal !== null)
        .map((t) => ({ day: t.date, ...(t.steps !== null && { steps: t.steps }), ...(t.totalKcal !== null && { calories: t.totalKcal }), source: SOURCE }));
      // One statement sets one column list: rows are grouped by the columns they carry.
      for (const group of groupByKeys(metricRows)) for (const r of await upsert(db, dailyMetrics, ["day"], userId, group)) dirty.add(r.day as string);
      const extra = totals.flatMap((t) => [
        ...(t.distanceM !== null ? [{ day: t.date, key: "distance", value: Math.round(t.distanceM) / 1000 }] : []),
        ...(t.activeKcal !== null ? [{ day: t.date, key: "active_calories", value: t.activeKcal }] : []),
      ]);
      await upsert(db, dailyValues, ["day", "key"], userId, extra);
      if (totals.length) await record("daily_totals", totals.map((t) => ({ uuid: t.date, start: localMidnight(t.date, tz), end: localMidnight(t.date, tz), source: null })), prov);
    }
    // ── Sleep ─────────────────────────────────────────────────────────────────
    {
      const prov = await provenance("sleep", p.sleep.map((s) => s.uuid));
      const admitted = p.sleep.filter((s) => admit(prov, s.uuid));
      const { sessions, segments: segs } = mapSleep(admitted, tz);
      if (sessions.length) {
        const ids = sessions.map((s) => s.id);
        const held = new Map((await db.select({ id: sleepSessions.id, isMain: sleepSessions.isMain }).from(sleepSessions).where(and(eq(sleepSessions.userId, userId), inArray(sleepSessions.id, ids)))).map((r) => [r.id, r.isMain]));
        const written = new Set((await upsert(db, sleepSessions, ["id"], userId, sessions.map((s) => ({ ...s, isMain: held.get(s.id) ?? false })))).map((r) => r.id as string));
        const resegmented = await replaceSegments(db, userId, ids, segs);
        for (const s of sessions) {
          if (written.has(s.id) || resegmented.has(s.id)) dirty.add(s.day);
          mainDays.add(s.day);
          refresh.add(s.day);
        }
        await record("sleep", admitted.map((s) => ({ uuid: s.uuid, start: s.start, end: s.end, source: s.source })), prov);
      }
    }
    // ── Exercise ──────────────────────────────────────────────────────────────
    {
      const prov = await provenance("exercise", p.exercise.map((e) => e.uuid));
      const admitted = p.exercise.filter((e) => admit(prov, e.uuid));
      const rows = mapExercises({ ...p, exercise: admitted }, tz);
      if (rows.length) {
        const written = new Set((await upsert(db, exercises, ["id"], userId, rows)).map((r) => r.id as string));
        for (const e of rows) if (written.has(e.id)) dirty.add(e.day);
        await record("exercise", admitted.map((e) => ({ uuid: e.uuid, start: e.start, end: e.end, source: e.source })), prov);
      }
    }
  }

  // ── Vitals and body readings (both roles) ───────────────────────────────────
  {
    const byKey = new Map<string, typeof p.vitals>();
    for (const v of p.vitals) byKey.set(KEY_OF_KIND[v.kind], [...(byKey.get(KEY_OF_KIND[v.kind]) ?? []), v]);
    for (const [key, vitals] of byKey) {
      const prov = await provenance(key, [...new Set(vitals.map((v) => v.recordUuid))]);
      const admitted = vitals.filter((v) => admit(prov, v.recordUuid));
      if (!admitted.length) continue;
      const rows = admitted.map((v) => ({ userId, kind: v.kind, ts: v.ts, value: v.value, recordUuid: v.recordUuid }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        await db
          .insert(hcVitals)
          .values(rows.slice(i, i + CHUNK))
          .onConflictDoUpdate({ target: [hcVitals.userId, hcVitals.kind, hcVitals.ts], set: { value: sql`excluded.value`, recordUuid: sql`excluded.record_uuid` } });
      }
      const spans = new Map<string, Span>();
      for (const v of admitted) {
        const s = spans.get(v.recordUuid);
        if (s) {
          s.start = Math.min(s.start, v.ts);
          s.end = Math.max(s.end, v.ts);
        } else spans.set(v.recordUuid, { uuid: v.recordUuid, start: v.ts, end: v.ts, source: v.source });
        refresh.add(dayOf(v.ts));
        if (NIGHT_KINDS.has(v.kind)) refresh.add(addDays(dayOf(v.ts), 1)); // a night's samples before midnight belong to the wake day
      }
      await record(key, [...spans.values()], prov);
    }
  }

  // ── Settle main sleep per touched day, then rederive each touched day from hc_vitals ──
  for (const day of await settleMain(db, userId, mainDays)) dirty.add(day);
  const refreshed = await refreshDays(db, o, refresh);
  for (const day of refreshed.days) dirty.add(day);

  if (dirty.size) await db.insert(intradayDirty).values([...dirty].map((day) => ({ userId, day }))).onConflictDoNothing();
  return dirty.size > 0 || refreshed.changed;
}

/** The [min, max + 1) span of a sample map, as mergeSamples wants a window. */
function span(samples: Map<number, number>) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const ts of samples.keys()) {
    if (ts < lo) lo = ts;
    if (ts > hi) hi = ts;
  }
  return { start: lo, end: hi + 1 };
}

/** Rows grouped by their set of keys, so each upsert statement names one column list. */
function groupByKeys<T extends Record<string, unknown>>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = Object.keys(r).sort().join(",");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()];
}

/** Replaces each session's segments where they differ. Returns the sessions whose segments changed. */
async function replaceSegments(db: Db, userId: number, sessionIds: string[], next: SegmentRow[]): Promise<Set<string>> {
  const changed = new Set<string>();
  if (!sessionIds.length) return changed;
  const held = await db
    .select({ sessionId: sleepSegments.sessionId, startTs: sleepSegments.startTs, endTs: sleepSegments.endTs, stage: sleepSegments.stage })
    .from(sleepSegments)
    .where(and(eq(sleepSegments.userId, userId), inArray(sleepSegments.sessionId, sessionIds)));
  const key = (xs: SegmentRow[], id: string) => JSON.stringify(xs.filter((s) => s.sessionId === id).map((s) => [s.startTs, s.endTs, s.stage]).sort((a, b) => (a[0] as number) - (b[0] as number)));
  for (const id of sessionIds) if (key(held, id) !== key(next, id)) changed.add(id);
  if (!changed.size) return changed;
  await db.delete(sleepSegments).where(and(eq(sleepSegments.userId, userId), inArray(sleepSegments.sessionId, [...changed])));
  const rows = next.filter((s) => changed.has(s.sessionId)).map((s) => ({ userId, ...s }));
  for (let i = 0; i < rows.length; i += CHUNK) await db.insert(sleepSegments).values(rows.slice(i, i + CHUNK));
  return changed;
}

/** One main session per wake day: the longest stored one (earliest, then id, on a tie). Returns the days whose flags moved. */
async function settleMain(db: Db, userId: number, days: Set<string>): Promise<string[]> {
  const moved: string[] = [];
  for (const day of days) {
    const rows = await db
      .select({ id: sleepSessions.id, startTs: sleepSessions.startTs, endTs: sleepSessions.endTs, isMain: sleepSessions.isMain })
      .from(sleepSessions)
      .where(and(eq(sleepSessions.userId, userId), eq(sleepSessions.day, day)));
    const main = [...rows].sort((a, b) => b.endTs - b.startTs - (a.endTs - a.startTs) || a.startTs - b.startTs || a.id.localeCompare(b.id))[0];
    for (const r of rows) {
      const want = r === main;
      if (r.isMain === want) continue;
      await db.update(sleepSessions).set({ isMain: want }).where(and(eq(sleepSessions.userId, userId), eq(sleepSessions.id, r.id)));
      moved.push(day);
    }
  }
  return [...new Set(moved)];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Rederives each day's daily_metrics columns and extra values from hc_vitals: the night's means (HRV, respiration,
 * SpO2, skin temperature) over the main sleep session (or 18:00 to noon without one), the day's latest resting HR,
 * weight, body fat, VO2 max and core temperature, the day's mean glucose. In the `fill` role only columns Google
 * left empty are written. Returns the days whose rows changed, and whether anything with no day of its own (height) did.
 */
export async function refreshDays(db: Db, o: Pick<ApplyOptions, "userId" | "tz" | "role">, days: Set<string>): Promise<{ days: string[]; changed: boolean }> {
  const { userId, tz } = o;
  const changed: string[] = [];
  let heightChanged = false;
  for (const day of days) {
    const dayStart = localMidnight(day, tz);
    const dayEnd = localMidnight(addDays(day, 1), tz);
    const [main] = await db
      .select({ startTs: sleepSessions.startTs, endTs: sleepSessions.endTs })
      .from(sleepSessions)
      .where(and(eq(sleepSessions.userId, userId), eq(sleepSessions.day, day), eq(sleepSessions.isMain, true)));
    const night = main ? { start: main.startTs, end: main.endTs } : { start: dayStart - NIGHT_FALLBACK.before, end: dayStart + NIGHT_FALLBACK.after };
    const lo = Math.min(night.start, dayStart);
    const hi = Math.max(night.end, dayEnd);
    const rows = await db
      .select({ kind: hcVitals.kind, ts: hcVitals.ts, value: hcVitals.value })
      .from(hcVitals)
      .where(and(eq(hcVitals.userId, userId), gte(hcVitals.ts, lo), lt(hcVitals.ts, hi)))
      .orderBy(hcVitals.ts);
    const inNight = (k: VitalKind) => rows.filter((r) => r.kind === k && r.ts >= night.start && r.ts <= night.end).map((r) => r.value);
    const inDay = (k: VitalKind) => rows.filter((r) => r.kind === k && r.ts >= dayStart && r.ts < dayEnd);
    const latest = (k: VitalKind) => inDay(k).at(-1)?.value ?? null;

    const vals: Record<string, number | string | null> = {};
    const put = (k: string, v: number | null) => {
      if (v !== null) vals[k] = r2(v);
    };
    put("hrvMs", mean(inNight("hrv")));
    put("respBpm", mean(inNight("resp")));
    put("spo2Pct", mean(inNight("spo2")));
    const delta = mean(inNight("skin_temp_delta"));
    if (delta !== null) {
      // With Fitbit's own baseline the stored night is a temperature; without one, the deviation itself and a zero
      // baseline, so Recovery's deviation (nightly − baseline) is the delta either way.
      const base = mean(inNight("skin_temp_baseline"));
      put("nightlyTempC", base !== null ? base + delta : delta);
      vals.tempBaselineC = base !== null ? r2(base) : 0;
    }
    const rhr = latest("rhr");
    if (rhr !== null) {
      vals.rhrBpm = Math.round(rhr);
      vals.rhrMethod = SOURCE;
    }
    put("weightKg", latest("weight"));
    put("bodyFatPct", latest("body_fat"));
    put("vo2maxDaily", latest("vo2_max"));

    const [existing] = await db.select().from(dailyMetrics).where(and(eq(dailyMetrics.userId, userId), eq(dailyMetrics.day, day)));
    if (o.role === "fill" && existing) for (const k of Object.keys(vals)) if (existing[k as keyof typeof existing] !== null) delete vals[k];
    if (Object.keys(vals).length) {
      // `source` must be in the row (NOT NULL is checked before ON CONFLICT); a row Google made keeps its own.
      const row: Record<string, unknown> = { day, ...vals, source: existing?.source ?? SOURCE };
      if ((await upsert(db, dailyMetrics, ["day"], userId, [row])).length) changed.push(day);
    }

    const extra: { day: string; key: string; value: number }[] = [];
    const glucose = mean(inDay("glucose").map((r) => r.value));
    if (glucose !== null) extra.push({ day, key: "glucose", value: r2(glucose) });
    const core = latest("core_temp");
    if (core !== null) extra.push({ day, key: "core_temp", value: r2(core) });
    await upsert(db, dailyValues, ["day", "key"], userId, extra);
  }
  // Height: the newest reading overall, as the Google source keeps it (Pulse Age's lean-mass term, profile fallback).
  const [h] = await db
    .select({ value: hcVitals.value })
    .from(hcVitals)
    .where(and(eq(hcVitals.userId, userId), eq(hcVitals.kind, "height")))
    .orderBy(sql`${hcVitals.ts} desc`)
    .limit(1);
  // Pulse Age's lean-mass term reads it when the profile has no height, so a new value rescores (as the Google source's does).
  if (h && days.size) {
    const written = await upsert(db, dailyValues, ["day", "key"], userId, [{ day: "latest", key: "height_cm", value: Math.round(h.value * 10) / 10 }]);
    heightChanged = written.length > 0;
  }
  return { days: [...new Set(changed)], changed: heightChanged };
}
