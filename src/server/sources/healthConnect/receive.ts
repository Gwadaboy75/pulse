// The webhook's work, apart from HTTP: verify, archive, answer. The route calls it and then asks the worker for a run.
// The phone waits 10 seconds for an answer, so nothing here reads the payload beyond its envelope; the sync worker
// applies it (sync.ts). Never logs or stores anything about a body that failed its signature.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { getConfig } from "../../config";
import type { Db } from "../../db";
import { ingestEndpoints, ingestPayloads } from "../../db/schema";
import { decryptKey } from "../../coach/crypto";
import { endpointByPublicId } from "./endpoint";
import { parsePayload } from "./parse";

/** The app's own guidance: allow at least 10 MB; a backfill payload of every type with metadata is a few MB. */
export const MAX_BODY = 12 * 1024 * 1024;

export type Receipt =
  | { status: 404 | 413 | 401 | 400 | 500 }
  /** A test ping or a screen-time payload: taken and dropped. */
  | { status: 204; userId: number }
  /** The same bytes again: already held. */
  | { status: 200; userId: number }
  /** Archived; the worker applies it. */
  | { status: 202; userId: number };

/** `sha256=<hex>` over the raw body with the endpoint's secret, compared in constant time after the length check. */
export function signatureOk(body: Uint8Array, secret: string, presented: string | null): boolean {
  if (!presented) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const got = Buffer.from(presented.trim());
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function receive(db: Db, req: { publicId: string; body: Uint8Array; signature: string | null; now?: number }): Promise<Receipt> {
  const now = req.now ?? Math.floor(Date.now() / 1000);
  const cfg = getConfig();
  if (cfg.demo || !/^[\w-]{16,64}$/.test(req.publicId)) return { status: 404 };
  const ep = await endpointByPublicId(db, req.publicId);
  if (!ep) return { status: 404 };
  if (req.body.byteLength > MAX_BODY) return { status: 413 };
  const secret = cfg.authSecret ? decryptKey(ep.secretCiphertext, cfg.authSecret) : null;
  if (!secret) return { status: 500 }; // sealed under another BETTER_AUTH_SECRET: Settings says to pair again
  if (!signatureOk(req.body, secret, req.signature)) return { status: 401 };

  const text = Buffer.from(req.body).toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    await db.update(ingestEndpoints).set({ lastReceivedAt: now, lastError: "bad_json" }).where(eq(ingestEndpoints.userId, ep.userId));
    return { status: 400 };
  }
  const p = parsePayload(json);
  const touch = { lastReceivedAt: now, ...(p.appVersion && { appVersion: p.appVersion }) };
  if (p.test || p.source !== "health_connect") {
    await db.update(ingestEndpoints).set({ ...touch, lastError: null }).where(eq(ingestEndpoints.userId, ep.userId));
    return { status: 204, userId: ep.userId };
  }
  const inserted = await db
    .insert(ingestPayloads)
    .values({
      userId: ep.userId,
      sequence: p.sequence,
      bodyHash: createHash("sha256").update(req.body).digest("hex"),
      kind: p.backfill ? "backfill" : "sync",
      gzBody: gzipSync(text),
      receivedAt: now,
      windowStart: p.backfill?.start ?? null,
      windowEnd: p.backfill?.end ?? null,
      windowComplete: p.backfill?.complete ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: ingestPayloads.id });
  await db
    .update(ingestEndpoints)
    .set({ ...touch, lastError: null, ...(p.sequence !== null && (ep.lastSequence === null || p.sequence > ep.lastSequence) && { lastSequence: p.sequence }) })
    .where(eq(ingestEndpoints.userId, ep.userId));
  return { status: inserted.length ? 202 : 200, userId: ep.userId };
}
