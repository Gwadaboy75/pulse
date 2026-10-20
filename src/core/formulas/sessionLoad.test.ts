import { describe, expect, it } from "vitest";
import { type DailyRpeLoad, sessionRpe, weeklyLoad } from "./sessionLoad";

const day = (d: number, load: number, rated = load ? 1 : 0, unrated = 0): DailyRpeLoad => ({ day: `2026-10-${String(d).padStart(2, "0")}`, load, rated, unrated });

describe("session-RPE and Foster's monotony", () => {
  it("session load is minutes × RPE", () => expect(sessionRpe(60, 7)).toBe(420));
  it("weekly load, monotony (mean / sample SD, rest days as 0) and strain", () => {
    const loads = [300, 0, 450, 0, 300, 600, 0];
    const r = weeklyLoad(loads.map((l, i) => day(i + 1, l)));
    const mean = 1650 / 7;
    const sd = Math.sqrt(loads.reduce((a, x) => a + (x - mean) ** 2, 0) / 6);
    expect(r.value!.weeklyLoad).toBe(1650);
    expect(r.value!.monotony).toBe(Math.round((mean / sd) * 100) / 100);
    expect(r.value!.strain).toBe(Math.round(1650 * (mean / sd)));
    expect(r.window).toEqual({ start: "2026-10-01", end: "2026-10-07" });
  });
  it("identical loads leave monotony undefined", () => {
    const r = weeklyLoad(Array.from({ length: 7 }, (_, i) => day(i + 1, 300)));
    expect(r.value!.monotony).toBeNull();
    expect(r.value!.strain).toBeNull();
  });
  it("no rated session gives null; unrated sessions are counted and noted", () => {
    expect(weeklyLoad(Array.from({ length: 7 }, (_, i) => day(i + 1, 0))).value).toBeNull();
    const r = weeklyLoad([day(1, 300), day(2, 0, 0, 1), ...Array.from({ length: 5 }, (_, i) => day(i + 3, 0))]);
    expect(r.value!.unrated).toBe(1);
    expect(r.coverage).toEqual({ have: 1, need: 2 });
    expect(r.notes[0]).toMatch(/sans effort ressenti/);
  });
  it("needs exactly 7 days", () => expect(weeklyLoad([day(1, 300)]).missing).toEqual(["dailyLoad"]));
});
