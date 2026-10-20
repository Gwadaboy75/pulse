// More, Settings and the shell's status (spec §7.14, §4.2). Pages also call worker.requestSync() on load.
import { getConfig } from "../config";
import { SCORING_VERSION } from "../pipeline";
import { missingScopes } from "../sources/google/oauth";
import { type Endpoint, endpointOf, ingestUrl, SYNC_KEY } from "../sources/healthConnect/endpoint";
import { addDays, wholeYears } from "../time";
import { and, count, desc, eq, lte, sql } from "drizzle-orm";
import { dailyScores, journalEntries, journalTags, oauthTokens, reports, syncState } from "../db/schema";
import { firstDay, type QueryCtx, todayOf } from "./common";
import { latestReport } from "./home";
import type { HealthConnectVM, MoreVM, SettingsVM, ShellStatusVM, YourDataVM } from "./types";

export { requestSync } from "../worker";

export const APP_VERSION = "0.1.0";
const STALE_MS = 2 * 3600_000;

/** The phone's row in the data-types list (sources/healthConnect/sync.ts writes sync_state's `health-connect`). */
const PHONE_GROUP = { key: SYNC_KEY, label: "Phone (Health Connect)", types: [SYNC_KEY] };

/** Google sync jobs grouped as Settings lists them. */
const GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "heart-rate", label: "Heart rate", types: ["heart-rate"] },
  { key: "steps", label: "Steps", types: ["steps", "steps-daily"] },
  { key: "sleep", label: "Sleep", types: ["sleep"] },
  { key: "hrv", label: "Heart rate variability", types: ["daily-heart-rate-variability"] },
  { key: "rhr", label: "Resting heart rate", types: ["daily-resting-heart-rate"] },
  { key: "resp", label: "Respiratory rate", types: ["daily-respiratory-rate"] },
  { key: "temp", label: "Skin temperature", types: ["daily-sleep-temperature-derivations"] },
  { key: "zones", label: "Heart rate zones", types: ["daily-heart-rate-zones", "time-in-heart-rate-zone"] },
  { key: "spo2", label: "Blood oxygen", types: ["daily-oxygen-saturation"] },
  { key: "exercise", label: "Exercise", types: ["exercise"] },
  { key: "vo2max", label: "VO2 max", types: ["daily-vo2-max", "run-vo2-max"] },
  { key: "calories", label: "Calories", types: ["total-calories"] },
  { key: "weight", label: "Weight and body fat", types: ["weight", "body-fat", "height"] },
  { key: "activity", label: "Distance, floors and active minutes", types: ["distance", "floors", "altitude", "active-zone-minutes", "active-minutes", "active-energy-burned", "sedentary-period", "heart-rate-daily", "swim-lengths-data"] },
  // logged-entries: Journal › Log's import of entries logged in other apps (sync.ts LOG_IMPORT_KEY).
  { key: "nutrition", label: "Food and water", types: ["hydration-log", "nutrition-log", "logged-entries"] },
  { key: "vitals", label: "Glucose and core temperature", types: ["blood-glucose", "core-body-temperature"] },
  { key: "rhythm", label: "ECG and irregular rhythm", types: ["electrocardiogram", "irregular-rhythm-notification"] },
];

/**
 * Shown-only types (extra metrics, records, height) and the Google inputs Pulse falls back from (zones, personal
 * ranges). Optional for the shell: one that fails (a scope granted only on
 * the next sign-in, a type the account never has) shows in Settings, but never turns the sync dot red or holds the
 * import banner open.
 */
const OPTIONAL_TYPES = new Set(GROUPS.filter((g) => ["zones", "activity", "nutrition", "vitals", "rhythm"].includes(g.key)).flatMap((g) => g.types).concat("height"));

/** Types every Google account syncs, and the phone's row: the shell's sync dot and the import banner follow these alone. */
const CORE_TYPES = new Set([...GROUPS.flatMap((g) => g.types).filter((t) => !OPTIONAL_TYPES.has(t)), SYNC_KEY]);

type SyncRow = {
  type: string;
  lastSuccessAt: number | null;
  lastError: string | null;
  backfillDaysDone: number | null;
  backfillDaysTotal: number | null;
};

function syncRows(ctx: QueryCtx): Promise<SyncRow[]> {
  const t = syncState;
  return ctx.db
    .select({ type: t.type, lastSuccessAt: t.lastSuccessAt, lastError: t.lastError, backfillDaysDone: t.backfillDaysDone, backfillDaysTotal: t.backfillDaysTotal })
    .from(t)
    .where(eq(t.userId, ctx.userId));
}

/** The sync worker's paired-device check (sources/google/sync.ts `DEVICES_KEY`): account state, not a data type. */
const DEVICES_ROW = "paired-devices";

/**
 * "not_linked": the grant works but the Google account has no Google Health profile, so every type fails the same way.
 * "no_device": it has a profile but no paired Fitbit device, so every type imports nothing.
 */
async function authState(ctx: QueryCtx, rows: SyncRow[]): Promise<"not_connected" | "not_linked" | "no_device" | "connected" | "revoked"> {
  const [t] = await ctx.db.select({ revokedAt: oauthTokens.revokedAt }).from(oauthTokens).where(eq(oauthTokens.userId, ctx.userId));
  if (!t) return "not_connected";
  if (t.revokedAt != null) return "revoked";
  if (rows.some((r) => r.lastError?.includes("ACCOUNT_NOT_LINKED"))) return "not_linked";
  return rows.some((r) => r.type === DEVICES_ROW && r.lastError?.includes("NO_PAIRED_DEVICE")) ? "no_device" : "connected";
}

/**
 * A sync error as a person reads it. `last_error` is `[google] <type>: <CODE> (HTTP n)` (GoogleError); the
 * code is kept in brackets for a bug report, the rest is dropped.
 */
export function syncErrorText(raw: string): string {
  const code = /: ([A-Za-z_0-9]+)(?: \(HTTP \d+\))?$/.exec(raw)?.[1] ?? raw;
  const text: Record<string, string> = {
    ACCOUNT_NOT_LINKED: "No Google Health profile",
    auth_revoked: "Access revoked",
    not_connected: "Not connected",
    RESOURCE_EXHAUSTED: "Rate limited, retrying",
    http_429: "Rate limited, retrying",
    PERMISSION_DENIED: "Permission missing",
  };
  return text[code] ?? (/^http_5\d\d$/.test(code) ? "Google is having trouble, retrying" : `Failed (${code})`);
}

/** The core types' backfill only: an optional type that keeps failing (or a retired job's leftover row) never holds it at 0. */
function importProgress(all: SyncRow[]) {
  const rows = all.filter((r) => CORE_TYPES.has(r.type));
  const pending = rows.filter((r) => r.backfillDaysTotal != null && (r.backfillDaysDone ?? 0) < r.backfillDaysTotal);
  if (!pending.length) return null;
  return { done: Math.min(...pending.map((r) => r.backfillDaysDone ?? 0)), total: Math.max(...pending.map((r) => r.backfillDaysTotal!)) };
}

/** The phone's state for Settings: null without an endpoint. `status` follows the worker's `health-connect` row. */
function healthConnectVM(ctx: QueryCtx, ep: Endpoint | null, rows: SyncRow[]): HealthConnectVM | null {
  if (!ep) return null;
  const nowMs = ctx.now * 1000;
  const row = rows.find((r) => r.type === SYNC_KEY);
  const error = ep.lastError ?? row?.lastError ?? null;
  const received = ep.lastReceivedAt;
  const status: HealthConnectVM["status"] = error ? "error" : received == null ? "waiting" : nowMs - received * 1000 > STALE_MS ? "stale" : "ok";
  const { appUrl } = getConfig();
  return {
    url: appUrl ? ingestUrl(appUrl, ep.publicId) : null,
    lastReceivedAt: received && received * 1000,
    lastAppliedAt: row?.lastSuccessAt ? row.lastSuccessAt * 1000 : null,
    lastSequence: ep.lastSequence,
    appVersion: ep.appVersion,
    role: ep.role,
    status,
    error: error ? ingestErrorText(error) : null,
  };
}

/** A phone-side error as a person reads it. */
export function ingestErrorText(raw: string): string {
  if (raw === "bad_json") return "The phone sent something Pulse couldn’t read";
  const m = /^\[health-connect\] payload \d+: (\w+)$/.exec(raw);
  return m ? `A payload failed to apply (${m[1]})` : `Failed (${raw})`;
}

/** Settings `/settings`: data source, auth, per-type sync status, backfill progress and the read-only profile. */
export async function getSettings(ctx: QueryCtx): Promise<SettingsVM> {
  const nowMs = ctx.now * 1000;
  const [rows, ep] = await Promise.all([syncRows(ctx), ctx.mode === "google" ? endpointOf(ctx.db, ctx.userId) : null]);
  const statusOf = (last: number | null, error: string | null): SettingsVM["sync"][number]["status"] =>
    error ? "error" : last == null ? "never" : nowMs - last * 1000 > STALE_MS ? "stale" : "ok";
  const auth = await authState(ctx, rows);
  // Google is in play when the server has a client, or the account still holds a grant from when it had one.
  const google = !!getConfig().google || auth !== "not_connected";
  const needsPermissions = ctx.mode === "google" && google && (auth === "connected" || auth === "no_device") && (await missingScopes(ctx.db, ctx.userId)).length > 0;
  // Not linked is one account-level problem, said once in Data source, not on every row.
  const rowError = (e: string | null) => (e && auth !== "not_linked" ? syncErrorText(e) : null);
  const group = (g: { key: string; label: string; types: string[] }) => {
    const members = rows.filter((r) => g.types.includes(r.type));
    const successes = members.map((r) => r.lastSuccessAt);
    const last = members.length && successes.every((s) => s != null) ? Math.min(...(successes as number[])) : null;
    const error = rowError(members.find((r) => r.lastError)?.lastError ?? null);
    return { key: g.key, label: g.label, lastSuccessAt: last && last * 1000, status: statusOf(last, error), error };
  };
  // The phone's row first when a phone is paired; Google's groups only where Google is set up and connected.
  const sync: SettingsVM["sync"] =
    ctx.mode === "demo"
      ? rows
          .filter((r) => r.type === "seed")
          .map((r) => ({ key: "seed", label: "Demo generator", lastSuccessAt: r.lastSuccessAt && r.lastSuccessAt * 1000, status: statusOf(r.lastSuccessAt, r.lastError), error: rowError(r.lastError) }))
      : [...(ep ? [group(PHONE_GROUP)] : []), ...(google && auth !== "not_connected" ? GROUPS.map(group) : [])];
  const p = ctx.profile;
  const today = todayOf(ctx);
  return {
    mode: ctx.mode,
    source:
      ctx.mode === "demo"
        ? { label: "Demo data", status: "demo" }
        : google
          ? { label: "Google Health", status: auth, needsPermissions }
          : { label: "Health Connect", status: ep?.lastReceivedAt ? "connected" : "not_connected" },
    healthConnect: ctx.mode === "demo" ? undefined : healthConnectVM(ctx, ep, rows),
    import: ctx.mode === "google" && auth === "connected" ? importProgress(rows) : null,
    sync,
    profile: {
      birthDate: p.birthDate,
      age: wholeYears(p.birthDate, today),
      sex: p.sex,
      maxHr: p.maxHr,
      maxHrSource: p.maxHrSource,
      timeZone: ctx.timeZone,
      heightCm: p.heightCm,
    },
    calc: ctx.calc,
    version: APP_VERSION,
    scoringVersion: SCORING_VERSION,
  };
}

/** More `/more`. */
export async function getMore(ctx: QueryCtx): Promise<MoreVM> {
  const [[tags], latestWeek, latestMonth, [reportCount]] = await Promise.all([
    ctx.db
      .select({ total: count(), shown: sql<number>`count(*) filter (where not ${journalTags.hidden})` })
      .from(journalTags)
      .where(eq(journalTags.userId, ctx.userId)),
    latestReport(ctx, "week"),
    latestReport(ctx, "month"),
    ctx.db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.userId, ctx.userId), sql`(${reports.data}->>'days')::numeric > 0`)),
  ]);
  return {
    latestWeek,
    latestMonth,
    reportCount: reportCount.n,
    behaviours: { shown: tags.shown, total: tags.total },
    mode: ctx.mode,
    version: APP_VERSION,
    scoringVersion: SCORING_VERSION,
  };
}

/** Your data `/more/data`: what each export holds. */
export async function getYourData(ctx: QueryCtx): Promise<YourDataVM> {
  const today = todayOf(ctx);
  const [first, [days], [answers]] = await Promise.all([
    firstDay(ctx),
    ctx.db
      .select({ n: count() })
      .from(dailyScores)
      .where(and(eq(dailyScores.userId, ctx.userId), lte(dailyScores.day, today))),
    ctx.db.select({ n: count() }).from(journalEntries).where(eq(journalEntries.userId, ctx.userId)),
  ]);
  return {
    first,
    days: first ? days.n : 0,
    answers: answers.n,
    mode: ctx.mode,
  };
}

/** Today counts toward the streak once it has this many minutes of heart rate; until then the streak ends yesterday. */
const STREAK_TODAY_MIN = 6 * 60;

/**
 * Consecutive worn days (spec §4.3, I4): the reference app's "continuous data" streak. A day is worn when it has any
 * heart rate, the same rule that keeps `band_not_worn` off its Strain. Null when the streak is 0.
 */
export async function getWearStreak(ctx: QueryCtx): Promise<{ days: number; asOf: string } | null> {
  const today = todayOf(ctx);
  const s = dailyScores;
  // ponytail: reads every scored day to find the first gap; page by a few hundred days if histories grow long.
  const rows = await ctx.db
    .select({
      day: s.day,
      hr: sql<number>`coalesce((${s.strain}->>'hrCount')::numeric, 0)`.mapWith(Number),
      minutes: sql<number>`coalesce((${s.strain}->>'hrMinutesAm')::numeric, 0) + coalesce((${s.strain}->>'hrMinutesPm')::numeric, 0)`.mapWith(Number),
    })
    .from(s)
    .where(and(eq(s.userId, ctx.userId), lte(s.day, today)))
    .orderBy(desc(s.day));
  let expected = today;
  let asOf: string | null = null;
  let days = 0;
  for (const r of rows) {
    if (r.day !== expected) break;
    expected = addDays(r.day, -1);
    // Today neither counts nor breaks the streak until it has enough data.
    if (r.day === today && r.minutes < STREAK_TODAY_MIN) continue;
    if (r.hr <= 0) break;
    asOf ??= r.day;
    days++;
  }
  return days > 0 && asOf ? { days, asOf } : null;
}

/** The AppShell's ShellStatus (top bar, sync dot, demo chip, ConnectionBanner). */
/** True while the sync worker is mid-run for this user (read off its global, so queries don't import the worker and its sources). */
const workerRunning = (userId: number) => !!(globalThis as { __pulseWorker?: { isRunning?(userId: number): boolean } }).__pulseWorker?.isRunning?.(userId);

export async function getShellStatus(ctx: QueryCtx): Promise<ShellStatusVM> {
  const [all, first, streak, ep] = await Promise.all([syncRows(ctx), firstDay(ctx), getWearStreak(ctx), ctx.mode === "google" ? endpointOf(ctx.db, ctx.userId) : null]);
  // The device check is account state (connection below), not a sync that succeeded or failed.
  // Core types only: an optional type, or a retired job's leftover row (rhr/hrv personal ranges), never turns the dot red.
  let auth: Awaited<ReturnType<typeof authState>> | "no_phone" = ctx.mode === "google" ? await authState(ctx, all) : "connected";
  // A paired phone that has delivered is a connection of its own: no "Connect Google" while the phone feeds the account.
  // Without a Google client on the server, the thing to do is pair a phone.
  if (auth === "not_connected") auth = ep?.lastReceivedAt ? "connected" : getConfig().google ? "not_connected" : "no_phone";
  // A test account filled by seed:demo never connects Google: it reads as demo data, not "Connect Google".
  const mode = (auth === "not_connected" || auth === "no_phone") && all.some((r) => r.type === "seed") ? "demo" : ctx.mode;
  const rows = all.filter((r) => (mode === "demo" ? r.type === "seed" : CORE_TYPES.has(r.type)));
  const successes = rows.map((r) => r.lastSuccessAt).filter((s): s is number => s != null);
  const lastSuccessAt = successes.length ? Math.max(...successes) * 1000 : null;
  // Seeded data on a Google instance isn't refreshed, so it's never "behind".
  const stale = mode !== ctx.mode ? false : lastSuccessAt == null || ctx.now * 1000 - lastSuccessAt > STALE_MS;
  const error = rows.some((r) => r.lastError);
  const progress = mode === "google" && auth === "connected" ? importProgress(rows) : null;
  const connection: ShellStatusVM["connection"] =
    mode === "demo"
      ? "connected"
      : auth === "not_connected" || auth === "no_phone" || auth === "not_linked" || auth === "no_device"
        ? auth
        : auth === "revoked"
          ? "auth_revoked"
          : progress
            ? "importing"
            : stale
              ? "stale"
              : "connected";
  return {
    mode,
    sync: { state: workerRunning(ctx.userId) ? "syncing" : error ? "error" : stale ? "stale" : "ok", lastSuccessAt },
    connection,
    ...(progress && { importProgress: progress }),
    today: todayOf(ctx),
    ...(first && { firstDay: first }),
    timeZone: ctx.timeZone,
    streak,
  };
}
