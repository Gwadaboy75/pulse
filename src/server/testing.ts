// Test helpers: an in-process Postgres (PGlite) per test, migrated, with one test user; a seeded demo database
// restored from the snapshot vitest.global-setup.ts builds once; and the options the pipeline and queries need.
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { inject } from "vitest";
import { CALC_DEFAULTS } from "./calc";
import { type Db, MIGRATIONS, rows, setDb } from "./db";
import * as schema from "./db/schema";
import { type PipelineOptions, recompute } from "./pipeline";
import type { QueryCtx } from "./queries/common";
import { seedPull } from "./sources/seed/generate";

export const TZ = "Asia/Kolkata";
export const PROFILE = { birthDate: "1990-01-01", sex: "male" as const, maxHr: 183, maxHrSource: "set" as const, heightCm: 178, timeZone: TZ };
/** The user every helper creates and scopes to. */
export const USER = 1;
export const OPTS: PipelineOptions = { userId: USER, timeZone: TZ, profile: PROFILE };
/** Friday 14:00, after wake; the seeded range then starts on Monday 2026-04-06 (day index 0). */
export const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
export const ANCHOR = "2026-04-06";
export const DAY_S = 86_400;

export const dayAt = (i: number) => new Date(Date.parse(ANCHOR) + i * DAY_S * 1000).toISOString().slice(0, 10);

// int8 and numeric as numbers, as the pg pool is set up (db/index.ts).
const PARSERS = { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) };
const handles = new WeakMap<Db, PGlite>();

function wrap(pg: PGlite): Db {
  const db = drizzle(pg, { schema }) as unknown as Db;
  handles.set(db, pg);
  return db;
}

/** Adds a user (id from the sequence) and returns its id. */
export async function addUser(db: Db, email = `user${Math.random().toString(36).slice(2)}@pulse.test`, name = "Test User"): Promise<number> {
  const [u] = await db.insert(schema.user).values({ name, email, emailVerified: true }).returning({ id: schema.user.id });
  return u.id;
}

/** An empty, migrated database with the test user (id 1). Also becomes getDb() unless `install` is false. */
export async function freshDb({ install = true } = {}): Promise<Db> {
  const pg = new PGlite({ parsers: PARSERS });
  const db = wrap(pg);
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  await db.insert(schema.user).values({ id: USER, name: "Test User", email: "test@pulse.test", emailVerified: true, username: "test" });
  await db.execute(sql`select setval(pg_get_serial_sequence('"user"', 'id'), 1)`);
  if (install) setDb(db);
  return db;
}

/** A demo database seeded up to each of `nows` in turn (unix seconds), optionally recomputed. */
export async function buildSeeded(nows: number[] = [NOW], { compute = true, install = true } = {}): Promise<Db> {
  const db = await freshDb({ install });
  for (const now of nows) await seedPull(db, { userId: USER, now, timeZone: TZ, maxHr: PROFILE.maxHr });
  if (compute) await recompute(db, OPTS);
  return db;
}

/**
 * A seeded demo database. With the default arguments it is restored from the snapshot vitest.global-setup.ts builds
 * once per run, instead of seeding its own.
 */
export async function seeded(nows: number[] = [NOW], { compute = true } = {}): Promise<Db> {
  const snapshot = nows.length === 1 && nows[0] === NOW && compute ? inject("seedDb") : undefined;
  if (!snapshot) return buildSeeded(nows, { compute });
  const db = wrap(new PGlite({ parsers: PARSERS, loadDataDir: new Blob([fs.readFileSync(snapshot)]) }));
  setDb(db);
  return db;
}

/** The data directory of a PGlite database, gzipped (global setup caches the seeded one). */
export async function snapshotOf(db: Db): Promise<Buffer> {
  const blob = await handles.get(db)!.dumpDataDir("gzip");
  return Buffer.from(await blob.arrayBuffer());
}

/** An independent copy of a database. */
export async function copyDb(db: Db): Promise<Db> {
  const blob = await handles.get(db)!.dumpDataDir("gzip");
  return wrap(new PGlite({ parsers: PARSERS, loadDataDir: blob }));
}

export const ctxFor = (db: Db, now = NOW, userId = USER): QueryCtx => ({ db, userId, timeZone: TZ, profile: PROFILE, calc: CALC_DEFAULTS, mode: "demo", now });

/** Every row of a table for the test user, in key order, as one string. */
export async function dump(db: Db, table: string, order = "1") {
  return JSON.stringify(await rows(db, sql.raw(`select * from "${table}" order by ${order}`)));
}

/** Kept for symmetry with the old file-based helpers: PGlite databases need no cleanup. */
export const cleanup = () => {};
