// The Health Connect source (Life Dashboard Companion on the user's phone -> /api/ingest/health-connect/<id>).
//
//   receive.ts   the webhook: signature, archive, answer within the phone's 10 seconds
//   sync.ts      the Source the worker pulls: applies archived payloads in sequence order
//   parse.ts     the app's JSON -> a typed payload          map.ts   payload -> table rows (as google/map.ts)
//   write.ts     one payload into the tables, with provenance for deletions, late payloads and backfill pruning
//   endpoint.ts  the user's URL, secret and pairing link
import { asc } from "drizzle-orm";
import type { Db } from "../../db";
import { ingestEndpoints } from "../../db/schema";

export { createHcSource, hcSource } from "./sync";
export { SYNC_KEY } from "./endpoint";

/** Every user with a phone endpoint, for the worker's cycle. */
export async function ingestUsers(db: Db): Promise<number[]> {
  return (await db.select({ id: ingestEndpoints.userId }).from(ingestEndpoints).orderBy(asc(ingestEndpoints.userId))).map((r) => r.id);
}
