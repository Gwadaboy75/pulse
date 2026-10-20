import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ingestEndpoints, oauthTokens, syncState } from "../db/schema";
import { ctxFor, freshDb, USER } from "../testing";
import { getSettings, getShellStatus, syncErrorText } from "./settings";

const google = async () => {
  const db = await freshDb();
  await db.insert(oauthTokens).values({ userId: USER, accessToken: "a", refreshToken: "r", expiresAt: 1, scope: "s", updatedAt: 1 });
  const put = (rows: Omit<typeof syncState.$inferInsert, "userId">[]) => db.insert(syncState).values(rows.map((r) => ({ ...r, userId: USER })));
  return { db, put, ctx: { ...ctxFor(db), mode: "google" as const } };
};

describe("sync errors", () => {
  it("read as a person would say them, keeping unknown codes", () => {
    expect(syncErrorText("[google] heart-rate: ACCOUNT_NOT_LINKED (HTTP 400)")).toBe("No Google Health profile");
    expect(syncErrorText("[google] steps dailyRollUp: RESOURCE_EXHAUSTED (HTTP 429)")).toBe("Rate limited, retrying");
    expect(syncErrorText("[google] sleep: http_503 (HTTP 503)")).toBe("Google is having trouble, retrying");
    expect(syncErrorText("[google] sleep: auth_revoked")).toBe("Access revoked");
    expect(syncErrorText("[google] sleep: INVALID_ARGUMENT (HTTP 400)")).toBe("Failed (INVALID_ARGUMENT)");
  });

  it("an account without Google Health is one problem: not_linked, no import progress, no per-row errors", async () => {
    const { put, ctx } = await google();
    await put(["heart-rate", "sleep"].map((type) => ({ type, backfillDaysDone: 0, backfillDaysTotal: 180, lastError: `[google] ${type}: ACCOUNT_NOT_LINKED (HTTP 400)` })));
    expect((await getShellStatus(ctx))).toMatchObject({ connection: "not_linked" });
    expect((await getShellStatus(ctx)).importProgress).toBeUndefined();
    const vm = (await getSettings(ctx));
    expect(vm.source.status).toBe("not_linked");
    expect(vm.import).toBeNull();
    expect(vm.sync.every((r) => r.error === null)).toBe(true);
  });

  it("a retired job's leftover error row and an optional type's failure never turn the sync dot red or hold the import", async () => {
    const { put, ctx } = await google();
    await put([{ type: "heart-rate", backfillDaysDone: 180, backfillDaysTotal: 180, lastSuccessAt: ctx.now }]);
    await put([{ type: "rhr-personal-range", backfillDaysDone: 0, backfillDaysTotal: 180, lastError: "[google] daily-resting-heart-rate dailyRollUp: UNSUPPORTED_DATA_TYPE_ACTION" }]);
    await put([{ type: "electrocardiogram", backfillDaysDone: 0, backfillDaysTotal: 180, lastError: "[google] electrocardiogram: INVALID_DATA_POINT_FILTER" }]);
    const shell = (await getShellStatus(ctx));
    expect(shell.sync.state).toBe("ok");
    expect(shell.importProgress).toBeUndefined();
    expect((await getSettings(ctx)).import).toBeNull();
  });

  it("a Google Health account with no paired device is one problem: no_device, no import progress, no sync error", async () => {
    const { db, put, ctx } = await google();
    await put([{ type: "heart-rate", backfillDaysDone: 30, backfillDaysTotal: 180, lastSuccessAt: ctx.now }]);
    await put([{ type: "paired-devices", lastSuccessAt: ctx.now, lastError: "[google] paired-devices: NO_PAIRED_DEVICE" }]);
    const shell = (await getShellStatus(ctx));
    expect(shell).toMatchObject({ connection: "no_device", sync: { state: "ok" } });
    expect(shell.importProgress).toBeUndefined();
    const vm = (await getSettings(ctx));
    expect(vm.source.status).toBe("no_device");
    expect(vm.import).toBeNull();
    expect(vm.sync.every((r) => r.error === null)).toBe(true);

    await db.update(syncState).set({ lastError: null }).where(and(eq(syncState.userId, USER), eq(syncState.type, "paired-devices")));
    expect((await getShellStatus(ctx)).connection).toBe("importing");
  });

  it("a working grant mid-import shows progress and readable row errors", async () => {
    const { put, ctx } = await google();
    await put([{ type: "heart-rate", backfillDaysDone: 30, backfillDaysTotal: 180, lastError: "[google] heart-rate: http_503 (HTTP 503)" }]);
    expect((await getShellStatus(ctx))).toMatchObject({ connection: "importing", importProgress: { done: 30, total: 180 } });
    expect((await getSettings(ctx)).sync.find((r) => r.key === "heart-rate")?.error).toBe("Google is having trouble, retrying");
  });
});

describe("the phone (Health Connect)", () => {
  // No Google client in the test environment (DATA_SOURCE unset): a real-account instance fed by the phone.
  it("without a phone the shell asks to pair one; a paired phone that delivered is the connection", async () => {
    const db = await freshDb();
    const ctx = { ...ctxFor(db), mode: "google" as const };
    expect((await getShellStatus(ctx)).connection).toBe("no_phone");
    let vm = await getSettings(ctx);
    expect(vm.source).toEqual({ label: "Health Connect", status: "not_connected" });
    expect(vm.healthConnect).toBeNull();
    expect(vm.sync).toEqual([]);

    await db.insert(ingestEndpoints).values({ userId: USER, publicId: "p".repeat(22), secretCiphertext: Buffer.alloc(40), createdAt: ctx.now });
    expect((await getShellStatus(ctx)).connection).toBe("no_phone");
    vm = await getSettings(ctx);
    expect(vm.healthConnect).toMatchObject({ status: "waiting", lastReceivedAt: null, url: null, role: "auto" });
    expect(vm.sync.map((r) => r.key)).toEqual(["health-connect"]);

    await db.update(ingestEndpoints).set({ lastReceivedAt: ctx.now - 60, appVersion: "1.23.0" }).where(eq(ingestEndpoints.userId, USER));
    await db.insert(syncState).values({ userId: USER, type: "health-connect", lastSuccessAt: ctx.now - 30 });
    const shell = await getShellStatus(ctx);
    expect(shell).toMatchObject({ connection: "connected", sync: { state: "ok" } });
    vm = await getSettings(ctx);
    expect(vm.source.status).toBe("connected");
    expect(vm.healthConnect).toMatchObject({ status: "ok", lastReceivedAt: (ctx.now - 60) * 1000, lastAppliedAt: (ctx.now - 30) * 1000, appVersion: "1.23.0" });
    expect(vm.sync[0]).toMatchObject({ key: "health-connect", status: "ok" });

    await db.update(ingestEndpoints).set({ lastError: "[health-connect] payload 3: SyntaxError" }).where(eq(ingestEndpoints.userId, USER));
    vm = await getSettings(ctx);
    expect(vm.healthConnect).toMatchObject({ status: "error", error: "A payload failed to apply (SyntaxError)" });
  });

  it("a demo instance has no phone card", async () => {
    const db = await freshDb();
    expect((await getSettings(ctxFor(db))).healthConnect).toBeUndefined();
  });
});
