// The user's phone endpoint (ingest_endpoints): its URL, its HMAC secret (sealed with BETTER_AUTH_SECRET, as the
// coach keys are) and the Life Dashboard Companion pairing link the Settings QR encodes.
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getConfig } from "../../config";
import type { Db } from "../../db";
import { ingestEndpoints, oauthTokens } from "../../db/schema";
import { decryptKey, encryptKey } from "../../coach/crypto";

/** The sync_state row the Health Connect source keeps (Settings' data-types list, the shell's sync dot). */
export const SYNC_KEY = "health-connect";
/** Where the app's pairing page lives; the app only trusts links on this host and path (PairingLink.kt). */
const PAIR_PAGE = "https://owen282000.github.io/life-dashboard-companion-app/pair";

export type Endpoint = typeof ingestEndpoints.$inferSelect;
export type Role = Endpoint["role"];

export const ingestPath = (publicId: string) => `/api/ingest/health-connect/${publicId}`;
export const ingestUrl = (appUrl: string, publicId: string) => `${appUrl.replace(/\/$/, "")}${ingestPath(publicId)}`;

/**
 * The link the app's "Scan a pairing code" reads: the URL, the signing secret and a name, for the Health section
 * only (Pulse has no use for screen time). The app refuses a URL with a credential in it, so the secret rides in
 * the fragment, which never reaches a server.
 */
export function pairingLink(url: string, secret: string, name = "Pulse"): string {
  const q = new URLSearchParams({ v: "1", url, secret, name, sources: "health_connect" });
  return `${PAIR_PAGE}#${q.toString().replaceAll("+", "%20")}`;
}

const secretOrThrow = () => {
  const s = getConfig().authSecret;
  if (!s) throw new Error("no_secret");
  return s;
};

/** 16 random bytes, URL-safe: the path segment that names the user without saying who they are. */
const newPublicId = () => randomBytes(16).toString("base64url");
/** 32 random bytes as hex: the app treats a secret as text, so hex keeps it typeable. */
const newSecret = () => randomBytes(32).toString("hex");

export async function endpointOf(db: Db, userId: number): Promise<Endpoint | null> {
  const [r] = await db.select().from(ingestEndpoints).where(eq(ingestEndpoints.userId, userId));
  return r ?? null;
}

export async function endpointByPublicId(db: Db, publicId: string): Promise<Endpoint | null> {
  const [r] = await db.select().from(ingestEndpoints).where(eq(ingestEndpoints.publicId, publicId));
  return r ?? null;
}

/** Creates the user's endpoint (or replaces it: a new URL and secret, the phone must be paired again). Returns the secret once. */
export async function createEndpoint(db: Db, userId: number, now = Math.floor(Date.now() / 1000)): Promise<{ publicId: string; secret: string }> {
  const secret = newSecret();
  const values = { publicId: newPublicId(), secretCiphertext: encryptKey(secret, secretOrThrow()), createdAt: now, lastReceivedAt: null, lastSequence: null, appVersion: null, lastError: null };
  await db.insert(ingestEndpoints).values({ userId, ...values }).onConflictDoUpdate({ target: ingestEndpoints.userId, set: values });
  return { publicId: values.publicId, secret };
}

/** A new secret for the same URL. Returns it once. */
export async function rotateSecret(db: Db, userId: number): Promise<string | null> {
  const secret = newSecret();
  const r = await db
    .update(ingestEndpoints)
    .set({ secretCiphertext: encryptKey(secret, secretOrThrow()), lastError: null })
    .where(eq(ingestEndpoints.userId, userId))
    .returning({ userId: ingestEndpoints.userId });
  return r.length ? secret : null;
}

/** The secret as the phone has it, or null when the endpoint is missing or was sealed under another BETTER_AUTH_SECRET. */
export async function revealSecret(db: Db, userId: number): Promise<string | null> {
  const ep = await endpointOf(db, userId);
  const s = getConfig().authSecret;
  return ep && s ? decryptKey(ep.secretCiphertext, s) : null;
}

/** Forgets the endpoint: the URL stops answering. The data the phone sent stays. */
export async function removeEndpoint(db: Db, userId: number): Promise<void> {
  await db.delete(ingestEndpoints).where(eq(ingestEndpoints.userId, userId));
}

export async function setRole(db: Db, userId: number, role: Role): Promise<void> {
  await db.update(ingestEndpoints).set({ role }).where(eq(ingestEndpoints.userId, userId));
}

/** What the phone's data is next to Google: `auto` fills only while a live Google grant exists on a Google instance. */
export async function effectiveRole(db: Db, userId: number, role: Role): Promise<"primary" | "fill"> {
  if (role !== "auto") return role;
  if (!getConfig().google) return "primary";
  const [live] = await db
    .select({ userId: oauthTokens.userId })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt)));
  return live ? "fill" : "primary";
}
