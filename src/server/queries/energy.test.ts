import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { CALC_DEFAULTS } from "../calc";
import { rmr } from "@/core/formulas/metabolism";
import { ctxFor, freshDb, PROFILE, seeded } from "../testing";
import { getEnergy } from "./energy";

let db: Db;
beforeAll(async () => {
  db = await seeded();
});

describe("getEnergy", () => {
  it("uses the latest weigh-in, the profile and the chosen equation, and compares every equation", async () => {
    const vm = await getEnergy(ctxFor(db));
    expect(vm.inputs.weight).not.toBeNull();
    expect(vm.inputs.heightCm).toBe(PROFILE.heightCm);
    expect(vm.equation).toBe("mifflin1990");
    const expected = rmr("mifflin1990", { weightKg: vm.inputs.weight!.value, heightCm: PROFILE.heightCm, ageYears: vm.inputs.age + 0.5, sex: "male", ffmKg: null }).value!;
    // Fractional age: within the 5 kcal a year moves Mifflin.
    expect(Math.abs((vm.rmr.value!.value as number) - expected)).toBeLessThanOrEqual(5);
    expect(vm.rmr.value!.id).toBe("rmr.mifflin1990");
    expect(vm.comparison).toHaveLength(10);
    expect(vm.comparison.filter((c) => c.inUse).map((c) => c.equation)).toEqual(["mifflin1990"]);
    // The seed has body fat, so the fat-free-mass equations compute.
    expect(vm.inputs.ffmKg).not.toBeNull();
    expect(vm.comparison.find((c) => c.equation === "cunningham1991")!.value).not.toBeNull();
    expect(vm.tdee.pal.value!.value).toBe(Math.round((vm.rmr.value!.value as number) * 1.375));
    expect(vm.tdee.eer.value).not.toBeNull();
    expect(vm.wearable.mean7).not.toBeNull();
    expect(vm.metabolicAge.value).not.toBeNull();
  });

  it("follows Settings › Calculs", async () => {
    const vm = await getEnergy({ ...ctxFor(db), calc: { ...CALC_DEFAULTS, rmrEquation: "henryOxford2005", activityLevel: "very_active" } });
    expect(vm.equation).toBe("henryOxford2005");
    expect(vm.rmr.value!.id).toBe("rmr.henryOxford2005");
    expect(vm.tdee.pal.value!.value).toBe(Math.round((vm.rmr.value!.value as number) * 1.725));
  });

  it("has no resting rate without a weigh-in, and says what is missing", async () => {
    const empty = await freshDb({ install: false });
    const vm = await getEnergy(ctxFor(empty));
    expect(vm.rmr.value).toBeNull();
    expect(vm.rmr.reason).toBe("no_data");
    expect(vm.comparison.every((c) => c.value === null)).toBe(true);
    expect(vm.comparison[0].missing).toContain("weightKg");
  });
});
