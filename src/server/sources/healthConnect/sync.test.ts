// The phone's webhook end to end: receive (signature, archive, answer), then the source applies what was archived,
// in sequence order, with deletions, late payloads, backfill pruning and the fill role beside Google.
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Config, parseConfig } from "../../config";
import type { Db } from "../../db";
import { dailyMetrics, dailyValues, exercises, hcRecords, hcVitals, ingestPayloads, intradayDirty, oauthTokens, sleepSegments, sleepSessions, syncState } from "../../db/schema";
import { readSamples } from "../../samples";
import { freshDb, USER } from "../../testing";
import { createEndpoint, endpointOf, revealSecret, SYNC_KEY } from "./endpoint";
import { MAX_BODY, receive } from "./receive";
import { createHcSource } from "./sync";

const h = vi.hoisted(() => ({ cfg: undefined as unknown }));
vi.mock("../../config", async (orig) => ({ ...(await orig<object>()), getConfig: () => h.cfg as Config }));

const TZ = "Europe/Paris";
const NOW = Date.parse("2026-10-04T10:00:00Z");
const t = (s: string) => Math.floor(Date.parse(s) / 1000);

let db: Db;
let publicId: string;
let secret: string;
let seq = 100;

const sign = (body: string, s = secret) => `sha256=${createHmac("sha256", s).update(body).digest("hex")}`;
/** Posts a payload as the app would: signed, with a fresh timestamp so every body is distinct. */
async function post(payload: Record<string, unknown>, opts: { secret?: string; signature?: string | null; id?: string } = {}) {
  const body = JSON.stringify({ timestamp: new Date(NOW + seq * 1000).toISOString(), app_version: "1.23.0", source: "health_connect", ...payload });
  const bytes = new TextEncoder().encode(body);
  return receive(db, { publicId: opts.id ?? publicId, body: bytes, signature: opts.signature === undefined ? sign(body, opts.secret) : opts.signature, now: NOW / 1000 });
}
const send = (payload: Record<string, unknown>) => post({ sequence: ++seq, ...payload });
const pull = () => createHcSource({ db, timeZone: TZ, now: () => NOW }).pull(USER);

const night = (end: string, uuid: string, hours = 7) => ({
  session_end_time: end,
  duration_seconds: hours * 3600,
  uuid,
  source: "com.fitbit.FitbitMobile",
  stages: [
    { stage: "light", start_time: new Date(Date.parse(end) - hours * 3600_000).toISOString(), end_time: new Date(Date.parse(end) - 3600_000).toISOString() },
    { stage: "deep", start_time: new Date(Date.parse(end) - 3600_000).toISOString(), end_time: end },
  ],
});

beforeEach(async () => {
  h.cfg = parseConfig({ DATA_SOURCE: "health-connect", BETTER_AUTH_SECRET: "x".repeat(32), APP_URL: "https://pulse.example.com" });
  db = await freshDb();
  ({ publicId, secret } = await createEndpoint(db, USER, NOW / 1000));
});

describe("receive", () => {
  it("answers 404 for an unknown or malformed id, 401 for a missing or wrong signature, 413 past the size cap", async () => {
    expect((await post({ test: true }, { id: "nope" })).status).toBe(404);
    expect((await post({ test: true }, { id: "a".repeat(22) })).status).toBe(404);
    expect((await post({ test: true }, { signature: null })).status).toBe(401);
    expect((await post({ test: true }, { secret: "wrong" })).status).toBe(401);
    expect((await post({ test: true }, { signature: "sha256=ab" })).status).toBe(401);
    const big = new Uint8Array(MAX_BODY + 1);
    expect((await receive(db, { publicId, body: big, signature: null })).status).toBe(413);
    expect(await db.select().from(ingestPayloads)).toHaveLength(0);
  });

  it("a demo instance has no endpoint to answer on", async () => {
    h.cfg = parseConfig({ DATA_SOURCE: "demo" });
    expect((await post({ test: true })).status).toBe(404);
  });

  it("a test ping and a screen-time payload are taken and dropped; bad JSON is a 400 that Settings can show", async () => {
    expect((await post({ test: true, message: "Test ping" })).status).toBe(204);
    expect((await post({ source: "screen_time", sequence: 1, screen_time: [] })).status).toBe(204);
    expect(await db.select().from(ingestPayloads)).toHaveLength(0);
    expect((await endpointOf(db, USER))?.lastReceivedAt).toBe(NOW / 1000);
    const bad = new TextEncoder().encode("{not json");
    expect((await receive(db, { publicId, body: bad, signature: sign("{not json") })).status).toBe(400);
    expect((await endpointOf(db, USER))?.lastError).toBe("bad_json");
  });

  it("archives a payload once: the same bytes again answer 200 and are not stored twice", async () => {
    const payload = { sequence: 5, steps: [{ count: 10, start_time: "2026-10-04T06:00:00Z", end_time: "2026-10-04T06:01:00Z", uuid: "s1" }] };
    expect((await post(payload)).status).toBe(202);
    expect((await post(payload)).status).toBe(200);
    const rows = await db.select().from(ingestPayloads);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sequence: 5, kind: "sync", appliedAt: null });
    expect((await endpointOf(db, USER))).toMatchObject({ lastSequence: 5, appVersion: "1.23.0" });
  });

  it("the secret is sealed and can be revealed for the pairing code", async () => {
    expect(await revealSecret(db, USER)).toBe(secret);
  });
});

describe("the source", () => {
  it("applies a sync payload: samples, sleep, exercise, nightly vitals, daily totals, dirty days and the sync row", async () => {
    await send({
      daily_totals: [{ date: "2026-10-04", steps: 1204, distance_meters: 911.6, active_calories: 58.2, total_calories: 702.9 }],
      steps: [{ count: 120, start_time: "2026-10-04T06:00:00Z", end_time: "2026-10-04T06:02:00Z", uuid: "s1", source: "com.fitbit.FitbitMobile" }],
      heart_rate: [
        { bpm: 61, time: "2026-10-04T06:58:00Z", uuid: "hr1#1", source: "com.fitbit.FitbitMobile" },
        { bpm: 63, time: "2026-10-04T06:58:05Z", uuid: "hr1#2", source: "com.fitbit.FitbitMobile" },
      ],
      heart_rate_variability: [
        { heart_rate_variability_millis: 40, time: "2026-10-04T01:10:00Z", uuid: "v1" },
        { heart_rate_variability_millis: 50, time: "2026-10-04T03:10:00Z", uuid: "v2" },
        { heart_rate_variability_millis: 99, time: "2026-10-04T09:00:00Z", uuid: "v3" }, // after waking: not the night's
      ],
      respiratory_rate: [{ rate: 15.5, time: "2026-10-04T03:00:00Z", uuid: "r1" }],
      oxygen_saturation: [{ percentage: 96, time: "2026-10-04T03:00:00Z", uuid: "o1" }],
      resting_heart_rate: [{ bpm: 52, time: "2026-10-04T07:00:00Z", uuid: "rhr1" }],
      skin_temperature: [
        { delta_celsius: -0.4, baseline_celsius: 33.5, time: "2026-10-04T02:00:00Z", uuid: "st#1" },
        { delta_celsius: -0.2, baseline_celsius: 33.5, time: "2026-10-04T03:00:00Z", uuid: "st#2" },
      ],
      weight: [{ kilograms: 75.5, time: "2026-10-04T07:00:00Z", uuid: "w1" }],
      height: [{ meters: 1.82, time: "2026-10-04T07:00:00Z", uuid: "h1" }],
      sleep: [night("2026-10-04T05:30:00Z", "sl1"), night("2026-10-04T13:00:00Z", "nap", 1)],
      exercise: [{ type: "56", name: "running", start_time: "2026-10-04T17:00:00Z", end_time: "2026-10-04T17:40:00Z", duration_seconds: 2400, uuid: "ex1" }],
    });
    expect(await pull()).toEqual({ changed: true });

    expect(await readSamples(db, "hr", USER, 0, 2e9)).toEqual([
      { ts: t("2026-10-04T06:58:00Z"), v: 61 },
      { ts: t("2026-10-04T06:58:05Z"), v: 63 },
    ]);
    expect((await readSamples(db, "steps", USER, 0, 2e9)).map((s) => s.v)).toEqual([60, 60]);

    const [m] = await db.select().from(dailyMetrics).where(and(eq(dailyMetrics.userId, USER), eq(dailyMetrics.day, "2026-10-04")));
    expect(m).toMatchObject({ hrvMs: 45, respBpm: 15.5, spo2Pct: 96, rhrBpm: 52, rhrMethod: "health_connect", nightlyTempC: 33.2, tempBaselineC: 33.5, weightKg: 75.5, steps: 1204, calories: 702.9, source: "health_connect" });
    const extras = await db.select({ day: dailyValues.day, key: dailyValues.key, value: dailyValues.value }).from(dailyValues).where(eq(dailyValues.userId, USER));
    expect(extras).toEqual(
      expect.arrayContaining([
        { day: "2026-10-04", key: "distance", value: 0.912 },
        { day: "2026-10-04", key: "active_calories", value: 58.2 },
        { day: "latest", key: "height_cm", value: 182 },
      ]),
    );

    const sessions = await db.select().from(sleepSessions).where(eq(sleepSessions.userId, USER)).orderBy(sleepSessions.startTs);
    expect(sessions.map((s) => [s.id, s.day, s.isMain, s.stagesStatus, s.asleepMin])).toEqual([
      ["sl1", "2026-10-04", true, "SUCCEEDED", 420],
      ["nap", "2026-10-04", false, "SUCCEEDED", 60],
    ]);
    // The night's two stages and the nap's deep hour (its light stage is zero-length and dropped).
    expect(await db.select().from(sleepSegments).where(eq(sleepSegments.userId, USER))).toHaveLength(3);
    expect((await db.select().from(exercises).where(eq(exercises.userId, USER)))[0]).toMatchObject({ id: "ex1", type: "RUNNING", day: "2026-10-04" });

    expect((await db.select().from(intradayDirty).where(eq(intradayDirty.userId, USER))).map((r) => r.day)).toEqual(["2026-10-04"]);
    const [st] = await db.select().from(syncState).where(and(eq(syncState.userId, USER), eq(syncState.type, SYNC_KEY)));
    expect(st).toMatchObject({ lastSuccessAt: NOW / 1000, lastError: null });
    expect((await db.select().from(ingestPayloads))[0]).toMatchObject({ appliedAt: NOW / 1000, error: null });
    const prov = await db.select({ type: hcRecords.type, uuid: hcRecords.uuid }).from(hcRecords).where(eq(hcRecords.userId, USER));
    expect(prov).toEqual(expect.arrayContaining([{ type: "heart_rate", uuid: "hr1" }, { type: "sleep", uuid: "sl1" }, { type: "heart_rate_variability", uuid: "v2" }, { type: "daily_totals", uuid: "2026-10-04" }]));

    // Nothing new: an honest `changed`, and the vitals keep the night's mean without the post-wake sample.
    expect(await pull()).toEqual({ changed: false });
  });

  it("a night without a session yet reads the evening-to-noon window, then the session's own once it arrives", async () => {
    await send({ heart_rate_variability: [{ heart_rate_variability_millis: 40, time: "2026-10-03T23:10:00Z", uuid: "v1" }, { heart_rate_variability_millis: 60, time: "2026-10-04T03:10:00Z", uuid: "v2" }] });
    await pull();
    const hrv = async () => (await db.select({ hrvMs: dailyMetrics.hrvMs }).from(dailyMetrics).where(and(eq(dailyMetrics.userId, USER), eq(dailyMetrics.day, "2026-10-04"))))[0]?.hrvMs;
    expect(await hrv()).toBe(50);
    await send({ sleep: [night("2026-10-04T05:30:00Z", "sl1", 5)] }); // 00:30–05:30 UTC: the 23:10 sample is before bed
    await pull();
    expect(await hrv()).toBe(60);
  });

  it("a deletion removes the record and its day's values; a lower sequence can't bring it back, a higher one can", async () => {
    await send({ sleep: [night("2026-10-04T05:30:00Z", "sl1")], heart_rate_variability: [{ heart_rate_variability_millis: 40, time: "2026-10-04T03:10:00Z", uuid: "v1" }] });
    await pull();
    const deletion = seq + 2;
    await post({ sequence: deletion, deleted_records: [{ type: "sleep", uuid: "sl1" }, { type: "heart_rate_variability", uuid: "v1" }] });
    await pull();
    expect(await db.select().from(sleepSessions).where(eq(sleepSessions.userId, USER))).toHaveLength(0);
    expect(await db.select().from(sleepSegments).where(eq(sleepSegments.userId, USER))).toHaveLength(0);
    expect(await db.select().from(hcVitals).where(eq(hcVitals.userId, USER))).toHaveLength(0);
    expect((await db.select().from(hcRecords).where(and(eq(hcRecords.userId, USER), eq(hcRecords.type, "sleep"))))[0]).toMatchObject({ uuid: "sl1", deletedSeq: deletion });
    // The late payload (built before the deletion) still names the night: ignored.
    await post({ sequence: deletion - 1, sleep: [night("2026-10-04T05:30:00Z", "sl1")] });
    await pull();
    expect(await db.select().from(sleepSessions).where(eq(sleepSessions.userId, USER))).toHaveLength(0);
    // Fitbit rewrote the night under the same id: it comes back.
    await post({ sequence: deletion + 1, sleep: [night("2026-10-04T05:40:00Z", "sl1")] });
    seq = deletion + 1;
    await pull();
    expect((await db.select().from(sleepSessions).where(eq(sleepSessions.userId, USER)))[0]).toMatchObject({ id: "sl1", endTs: t("2026-10-04T05:40:00Z"), isMain: true });
  });

  it("a complete backfill window prunes the records it did not carry; an incomplete one never does", async () => {
    await send({ sleep: [night("2026-10-02T05:30:00Z", "gone"), night("2026-10-03T05:30:00Z", "kept")] });
    await pull();
    const win = { backfill: true, window_start: "2026-10-01T07:15:02Z", window_end: "2026-10-04T07:15:02Z" };
    await send({ ...win, window_complete: false, sleep: [night("2026-10-03T05:30:00Z", "kept")] });
    await pull();
    expect((await db.select().from(sleepSessions).where(eq(sleepSessions.userId, USER))).map((s) => s.id).sort()).toEqual(["gone", "kept"]);
    await send({ ...win, window_complete: true, exercise: [{ type: "56", name: "running", start_time: "2026-10-03T17:00:00Z", end_time: "2026-10-03T17:40:00Z", duration_seconds: 2400, uuid: "ex1" }] });
    await pull();
    expect((await db.select().from(sleepSessions).where(eq(sleepSessions.userId, USER))).map((s) => s.id)).toEqual(["kept"]);
    expect(await db.select().from(exercises).where(eq(exercises.userId, USER))).toHaveLength(1);
  });

  it("a repeated sequence is skipped, a payload the mapper rejects fails alone, and the next one still applies", async () => {
    await send({ steps: [{ count: 10, start_time: "2026-10-04T06:00:00Z", end_time: "2026-10-04T06:01:00Z", uuid: "s1" }] });
    await post({ sequence: seq, steps: [{ count: 99, start_time: "2026-10-04T06:00:00Z", end_time: "2026-10-04T06:01:00Z", uuid: "s1" }], extra: 1 });
    await pull();
    expect((await readSamples(db, "steps", USER, 0, 2e9)).map((s) => s.v)).toEqual([10]);
    const rows = await db.select({ error: ingestPayloads.error, appliedAt: ingestPayloads.appliedAt }).from(ingestPayloads).orderBy(ingestPayloads.id);
    expect(rows).toEqual([
      { error: null, appliedAt: NOW / 1000 },
      { error: "duplicate_sequence", appliedAt: NOW / 1000 },
    ]);
  });

  it("beside a live Google grant the phone fills only what Google left empty", async () => {
    h.cfg = parseConfig({ DATA_SOURCE: "google", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s", BETTER_AUTH_SECRET: "x".repeat(32) });
    await db.insert(oauthTokens).values({ userId: USER, accessToken: "a", refreshToken: "r", expiresAt: 1, scope: "s", updatedAt: 1 });
    await db.insert(dailyMetrics).values({ userId: USER, day: "2026-10-04", hrvMs: 70, source: "google" });
    await send({
      heart_rate: [{ bpm: 61, time: "2026-10-04T06:58:00Z", uuid: "hr1#1" }],
      sleep: [night("2026-10-04T05:30:00Z", "sl1")],
      heart_rate_variability: [{ heart_rate_variability_millis: 40, time: "2026-10-04T03:10:00Z", uuid: "v1" }],
      respiratory_rate: [{ rate: 15.5, time: "2026-10-04T03:00:00Z", uuid: "r1" }],
    });
    expect(await pull()).toEqual({ changed: true });
    expect(await readSamples(db, "hr", USER, 0, 2e9)).toEqual([]);
    expect(await db.select().from(sleepSessions).where(eq(sleepSessions.userId, USER))).toHaveLength(0);
    const [m] = await db.select().from(dailyMetrics).where(and(eq(dailyMetrics.userId, USER), eq(dailyMetrics.day, "2026-10-04")));
    expect(m).toMatchObject({ hrvMs: 70, respBpm: 15.5, source: "google" });
  });
});
