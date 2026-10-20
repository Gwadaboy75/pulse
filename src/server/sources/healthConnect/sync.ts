// The Health Connect source: the phone's payloads, archived by the webhook (receive.ts), applied in sequence order
// on the worker's run. Each payload applies in its own transaction and fails on its own: a payload the mapper can't
// read records its reason and the next one still lands. sync_state's `health-connect` row carries the run's outcome
// for Settings and the shell, as the Google jobs' rows do.
import { gunzipSync } from "node:zlib";
import { and, asc, eq, isNotNull, isNull, lt, min, ne, sql } from "drizzle-orm";
import { type Db, getDb } from "../../db";
import { ingestEndpoints, ingestPayloads, syncState } from "../../db/schema";
import { getProfile } from "../../profile";
import { RAW_RETENTION_DAYS } from "../google/client";
import type { Source } from "../types";
import { effectiveRole, endpointOf, SYNC_KEY } from "./endpoint";
import { parsePayload } from "./parse";
import { applyPayload } from "./write";

export type HcDeps = { db: Db; timeZone: string; now?: () => number; log?: Pick<Console, "error"> };

export function createHcSource({ db, timeZone: tz, now = Date.now, log = console }: HcDeps): Source {
  const nowS = () => Math.floor(now() / 1000);
  return {
    async pull(userId: number) {
      const ep = await endpointOf(db, userId);
      if (!ep) return { changed: false };
      const t = nowS();
      const setState = (patch: Partial<typeof syncState.$inferInsert>) =>
        db
          .insert(syncState)
          .values({ userId, type: SYNC_KEY, ...patch })
          .onConflictDoUpdate({ target: [syncState.userId, syncState.type], set: patch });
      await setState({ lastAttemptAt: t });
      const role = await effectiveRole(db, userId, ep.role);
      const P = ingestPayloads;
      const pending = await db
        .select({ id: P.id, sequence: P.sequence, gzBody: P.gzBody, kind: P.kind, windowStart: P.windowStart, windowEnd: P.windowEnd, windowComplete: P.windowComplete })
        .from(P)
        .where(and(eq(P.userId, userId), isNull(P.appliedAt)))
        .orderBy(sql`${P.sequence} asc nulls last`, asc(P.id));
      let changed = false;
      let firstError: string | null = null;
      for (const row of pending) {
        const done = (error: string | null) => db.update(P).set({ appliedAt: nowS(), error }).where(eq(P.id, row.id));
        try {
          // The same sequence applied already (a repeat with a byte-level difference): skip, as the app asks.
          if (row.sequence !== null) {
            const [dup] = await db
              .select({ id: P.id })
              .from(P)
              .where(and(eq(P.userId, userId), eq(P.sequence, row.sequence), isNotNull(P.appliedAt), ne(P.id, row.id)))
              .limit(1);
            if (dup) {
              await done("duplicate_sequence");
              continue;
            }
          }
          if (!row.gzBody) {
            await done("body_pruned");
            continue;
          }
          const p = parsePayload(JSON.parse(gunzipSync(row.gzBody).toString("utf8")));
          // Without a sequence (an old app) a payload applies as the oldest: it adds what is missing and overrides nothing.
          const seq = row.sequence ?? 0;
          let prune: { start: number; end: number; beforeSeq: number } | null = null;
          if (row.kind === "backfill" && row.windowComplete && row.windowStart !== null && row.windowEnd !== null) {
            const [first] = await db
              .select({ seq: min(P.sequence) })
              .from(P)
              .where(and(eq(P.userId, userId), eq(P.kind, "backfill"), eq(P.windowStart, row.windowStart), isNotNull(P.sequence)));
            prune = { start: row.windowStart, end: row.windowEnd, beforeSeq: first?.seq ?? seq };
          }
          const wrote = await db.transaction(async (tx) => {
            const c = await applyPayload(tx, { userId, tz, role, seq, prune }, p);
            await tx.update(P).set({ appliedAt: nowS(), error: null }).where(eq(P.id, row.id));
            return c;
          });
          changed ||= wrote;
        } catch (err) {
          // The reason only, never the body: a payload is health data, and a driver error quotes its parameters.
          const reason = err instanceof Error ? err.name : "error";
          firstError ??= `[health-connect] payload ${row.id}: ${reason}`;
          log.error(`[health-connect] user ${userId} payload ${row.id} failed: ${err instanceof Error ? `${err.name}: ${err.message.split("\nparams:")[0]}` : String(err)}`);
          await done(reason).catch(() => {});
        }
      }
      await setState(firstError ? { lastError: firstError } : { lastSuccessAt: nowS(), lastError: null });
      await db.update(ingestEndpoints).set({ lastError: firstError }).where(eq(ingestEndpoints.userId, userId));
      // Bodies are evidence for a mapper fix, not a backup: dropped a week after they were applied; the rows stay for dedupe.
      await db
        .update(P)
        .set({ gzBody: null })
        .where(and(eq(P.userId, userId), isNotNull(P.gzBody), lt(P.appliedAt, nowS() - RAW_RETENTION_DAYS * 86_400)));
      return { changed };
    },
  };
}

/** The app's source: the database and the user's zone from the profile (UTC before onboarding). */
export const hcSource: Source = {
  async pull(userId) {
    const db = getDb();
    const timeZone = (await getProfile(db, userId))?.timeZone ?? "UTC";
    return createHcSource({ db, timeZone }).pull(userId);
  },
};
