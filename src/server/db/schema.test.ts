// The schema's two structural promises: the migration applies to an empty Postgres, and every table outside
// better-auth's belongs to a user (a user_id column that cascades when the account is deleted).
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rows } from "./index";
import { freshDb } from "../testing";

// Auth tables, and the server-wide ones (admin panel): none belongs to one user.
const AUTH = new Set(["user", "session", "account", "verification", "rate_limit", "invites", "server_settings", "coach_prompts"]);

describe("schema", () => {
  it("every data table has user_id, first in its primary key, cascading from user", async () => {
    const db = await freshDb({ install: false });
    const tables = (await rows<{ t: string }>(db, sql`select table_name t from information_schema.tables where table_schema = 'public' order by 1`)).map((r) => r.t);
    const data = tables.filter((t) => !AUTH.has(t));
    expect(data.length).toBeGreaterThan(15);
    const fks = await rows<{ t: string; rule: string }>(
      db,
      sql`select tc.table_name t, rc.delete_rule rule
          from information_schema.table_constraints tc
          join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name
          join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
          join information_schema.constraint_column_usage cu on cu.constraint_name = tc.constraint_name
          where tc.constraint_type = 'FOREIGN KEY' and k.column_name = 'user_id' and cu.table_name = 'user'`,
    );
    const cascading = new Set(fks.filter((f) => f.rule === "CASCADE").map((f) => f.t));
    expect(data.filter((t) => !cascading.has(t))).toEqual([]);
    const pkFirst = await rows<{ t: string; c: string }>(
      db,
      sql`select tc.table_name t, k.column_name c from information_schema.table_constraints tc
          join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name
          where tc.constraint_type = 'PRIMARY KEY' and k.ordinal_position = 1`,
    );
    const firstCol = new Map(pkFirst.map((r) => [r.t, r.c]));
    // raw_payloads and ingest_payloads key on a serial id; their dedupe uniques start with user_id.
    expect(data.filter((t) => t !== "raw_payloads" && t !== "ingest_payloads" && firstCol.get(t) !== "user_id")).toEqual([]);
  });
});
