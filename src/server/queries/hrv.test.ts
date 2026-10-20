import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { CALC_DEFAULTS } from "../calc";
import { ctxFor, freshDb, seeded } from "../testing";
import { getHrvPanel, HRV_HISTORY_DAYS } from "./hrv";

let db: Db;
beforeAll(async () => {
  db = await seeded();
});

describe("getHrvPanel", () => {
  it("builds the reference from the nights before the latest one, on the seeded history", async () => {
    const vm = await getHrvPanel(ctxFor(db));
    expect(vm.points).toHaveLength(HRV_HISTORY_DAYS);
    const p = vm.panel.value!;
    expect(p.latest).not.toBeNull();
    expect(p.reference).not.toBeNull();
    expect(p.reference!.method).toBe("ewma");
    expect(p.referenceDays).toBe(60);
    expect(p.trend).not.toBeNull();
    expect(p.cv7).not.toBeNull();
    expect(vm.position).not.toBeNull();
    // The band is built on ln: its bounds enclose the reference centre.
    expect(p.reference!.lo).toBeLessThan(p.reference!.center);
    expect(p.reference!.hi).toBeGreaterThan(p.reference!.center);
  });

  it("follows the chosen method and window", async () => {
    const vm = await getHrvPanel({ ...ctxFor(db), calc: { ...CALC_DEFAULTS, hrvReferenceMethod: "median_mad", hrvReferenceDays: 28 } });
    expect(vm.panel.value!.reference!.method).toBe("median_mad");
    expect(vm.panel.value!.referenceDays).toBe(28);
  });

  it("has nothing without nightly HRV", async () => {
    const vm = await getHrvPanel(ctxFor(await freshDb({ install: false })));
    expect(vm.panel.value).toBeNull();
    expect(vm.panel.reason).toBe("no_data");
    expect(vm.position).toBeNull();
  });
});
