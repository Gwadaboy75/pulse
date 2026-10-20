import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { exercises } from "./db/schema";
import { getFeedback, perceivedLoad, setFeedback } from "./feedback";
import { addUser, copyDb, dayAt, seeded, USER } from "./testing";
import { ctxFor } from "./testing";
import { getActivity } from "./queries/activity";
import { getStrain } from "./queries/strain";
import { SEED_DAYS } from "./sources/seed/scenario";

let db: Db;
let ids: { id: string; day: string }[];
beforeAll(async () => {
  db = await copyDb(await seeded());
  ids = await db.select({ id: exercises.id, day: exercises.day }).from(exercises).orderBy(exercises.day);
});

describe("activity feedback", () => {
  it("saves a rating for the person's own exercise, reads it back, clears it", async () => {
    const e = ids[ids.length - 1];
    expect(await setFeedback(db, USER, { exerciseId: e.id, rpe: 7, note: "jambes lourdes" })).toBe(true);
    expect((await getFeedback(db, USER, [e.id])).get(e.id)).toEqual({ rpe: 7, note: "jambes lourdes" });
    expect(await setFeedback(db, USER, { exerciseId: e.id, rpe: null, note: null })).toBe(true);
    expect((await getFeedback(db, USER, [e.id])).size).toBe(0);
  });

  it("refuses an exercise that isn't the person's", async () => {
    const other = await addUser(db);
    expect(await setFeedback(db, other, { exerciseId: ids[0].id, rpe: 5, note: null })).toBe(false);
    expect((await getFeedback(db, other, [ids[0].id])).size).toBe(0);
  });

  it("perceived load: minutes × RPE per day, rest days as 0, unrated sessions counted", () => {
    const day = "2026-10-07";
    const exs = [
      { id: "a", day: "2026-10-01", startTs: 0, endTs: 3600 },
      { id: "b", day: "2026-10-03", startTs: 0, endTs: 1800 },
      { id: "c", day: "2026-10-07", startTs: 0, endTs: 2700 },
    ];
    const r = perceivedLoad(day, exs, new Map([["a", { rpe: 6, note: null }], ["c", { rpe: 4, note: null }]]));
    expect(r.value!.weeklyLoad).toBe(60 * 6 + 45 * 4);
    expect(r.value!.unrated).toBe(1);
    expect(r.value!.rated).toBe(2);
    expect(r.window).toEqual({ start: "2026-10-01", end: "2026-10-07" });
  });

  it("shows on the activity and the Strain screens once a session is rated", async () => {
    const last = dayAt(SEED_DAYS - 1);
    const recent = ids.filter((e) => e.day <= last).at(-1)!;
    const before = await getActivity(recent.id, ctxFor(db));
    expect(before!.feedback.rpe).toBeNull();
    expect(before!.feedback.load).toBeNull();
    await setFeedback(db, USER, { exerciseId: recent.id, rpe: 8, note: null });
    const after = await getActivity(recent.id, ctxFor(db));
    expect(after!.feedback.rpe).toBe(8);
    expect(after!.feedback.load).toBe(Math.round(after!.feedback.minutes * 8));
    const strain = await getStrain(recent.day, ctxFor(db));
    expect(strain.perceived.metric.value!.weeklyLoad).toBeGreaterThan(0);
    expect(strain.perceived.metric.value!.rated).toBe(1);
  });
});
