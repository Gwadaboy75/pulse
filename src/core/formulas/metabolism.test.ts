import { describe, expect, it } from "vitest";
import { ACTIVITY_LEVELS, ageBand, eer2023, fatFreeMass, KCAL_PER_MJ, metKcal, metabolicAge, PAL, rmr, RMR_EQUATIONS, type RmrInputs, tdeePal } from "./metabolism";

/** The audit's worked example: a 40-year-old man, 80 kg, 180 cm, fat-free mass 60 kg. */
const man40: RmrInputs = { weightKg: 80, heightCm: 180, ageYears: 40, sex: "male", ffmKg: 60 };
/** ten Haaf's example: 30 years, 80 kg, 1.80 m, FFM 60 kg. */
const man30: RmrInputs = { ...man40, ageYears: 30 };

describe("resting metabolism equations (golden values from the audit)", () => {
  it("Mifflin-St Jeor 1990", () => expect(rmr("mifflin1990", man40).value).toBe(1730));
  it("Roza-Shizgal 1984", () => expect(rmr("rozaShizgal1984", man40).value).toBe(1797));
  it("Cunningham 1980", () => expect(rmr("cunningham1980", man40).value).toBe(1820));
  it("Cunningham 1991 (Katch-McArdle)", () => expect(rmr("cunningham1991", man40).value).toBe(1666));
  it("ten Haaf 2014, anthropometric and fat-free mass", () => {
    expect(rmr("tenHaaf2014", man30).value).toBe(1989);
    expect(rmr("tenHaaf2014Ffm", man30).value).toBe(1851);
  });
  it("Harris-Benedict 1919 uses 6.7550 (men, age) and 655.0955 (women, intercept)", () => {
    expect(rmr("harrisBenedict1919", man40).value).toBe(Math.round(66.473 + 13.7516 * 80 + 5.0033 * 180 - 6.755 * 40));
    const woman: RmrInputs = { weightKg: 60, heightCm: 165, ageYears: 35, sex: "female", ffmKg: null };
    expect(rmr("harrisBenedict1919", woman).value).toBe(Math.round(655.0955 + 9.5634 * 60 + 1.8496 * 165 - 4.6756 * 35));
  });
  it("Mifflin for a woman subtracts 161", () => {
    expect(rmr("mifflin1990", { weightKg: 60, heightCm: 165, ageYears: 35, sex: "female", ffmKg: null }).value).toBe(Math.round(600 + 1031.25 - 175 - 161));
  });
  it("Owen 1987", () => {
    expect(rmr("owen1987", man40).value).toBe(Math.round(879 + 10.2 * 80));
    expect(rmr("owen1987", { ...man40, sex: "female" }).value).toBe(Math.round(795 + 7.18 * 80));
  });
  it("weight-only tables change band on the 30th and 60th birthdays", () => {
    expect(ageBand(29.9)).toBe(0);
    expect(ageBand(30)).toBe(1);
    expect(ageBand(59.99)).toBe(1);
    expect(ageBand(60)).toBe(2);
    expect(rmr("schofield1985", man40).value).toBe(Math.round(11.472 * 80 + 873.1));
    expect(rmr("schofield1985", { ...man40, ageYears: 25 }).value).toBe(Math.round(15.057 * 80 + 692.2));
    expect(rmr("henryOxford2005", man40).value).toBe(Math.round((0.0592 * 80 + 2.48) * KCAL_PER_MJ));
    expect(rmr("henryOxford2005", { ...man40, ageYears: 65, sex: "female" }).value).toBe(Math.round((0.0424 * 80 + 2.38) * KCAL_PER_MJ));
  });
  it("a missing input gives null with the key named, never a guess", () => {
    const r = rmr("cunningham1991", { ...man40, ffmKg: null });
    expect(r.value).toBeNull();
    expect(r.missing).toEqual(["ffmKg"]);
    const h = rmr("mifflin1990", { ...man40, heightCm: null });
    expect(h.value).toBeNull();
    expect(h.missing).toEqual(["heightCm"]);
  });
  it("every equation stamps its registry id and version and carries its inputs with units", () => {
    for (const eq of RMR_EQUATIONS) {
      const r = rmr(eq, man30);
      expect(r.id).toBe(`rmr.${eq}`);
      expect(r.version).toBe("1");
      expect(r.unit).toBe("kcal/j");
      for (const i of Object.values(r.inputs)) expect(i.unit).toBeTruthy();
    }
  });
  it("out-of-domain inputs still compute, with a note", () => {
    const r = rmr("tenHaaf2014", man40);
    expect(r.value).not.toBeNull();
    expect(r.notes.some((n) => /hors domaine/.test(n))).toBe(true);
    expect(rmr("tenHaaf2014", man30).notes.some((n) => /hors domaine/.test(n))).toBe(false);
  });
  it("fat-free mass from weight and body fat", () => expect(fatFreeMass(80, 25)).toBe(60));
});

describe("total daily energy expenditure", () => {
  it("PAL multiplies the resting rate by the conventional factor", () => {
    expect(PAL).toEqual({ inactive: 1.2, low_active: 1.375, active: 1.55, very_active: 1.725 });
    expect(tdeePal(1730, "low_active").value).toBe(Math.round(1730 * 1.375));
  });
  it("EER 2023 is a total requirement from weight, height and age", () => {
    const m = eer2023("male", "inactive", { weightKg: 80, heightCm: 180, ageYears: 40 });
    expect(m.value).toBe(Math.round(753.07 - 10.83 * 40 + 6.5 * 180 + 14.1 * 80));
    const f = eer2023("female", "very_active", { weightKg: 60, heightCm: 165, ageYears: 35 });
    expect(f.value).toBe(Math.round(511.83 - 7.01 * 35 + 9.07 * 165 + 12.56 * 60));
    for (const l of ACTIVITY_LEVELS) expect(eer2023("male", l, { weightKg: 80, heightCm: 180, ageYears: 40 }).value).toBeGreaterThan(1700);
    expect(eer2023("male", "active", { weightKg: 80, heightCm: null, ageYears: 40 }).missing).toEqual(["heightCm"]);
  });
  it("MET energy, gross and net", () => {
    // 8 METs, 80 kg, 30 min: 8 × 3.5 × 80 / 200 × 30 = 336 kcal; net 294.
    expect(metKcal(8, 80, 30).value).toBe(336);
    expect(metKcal(8, 80, 30, true).value).toBe(294);
  });
  it("metabolic age inverts Mifflin: the reference rate gives the person's own age", () => {
    expect(metabolicAge(1730, { weightKg: 80, heightCm: 180, sex: "male" }).value).toBe(40);
    expect(metabolicAge(1830, { weightKg: 80, heightCm: 180, sex: "male" }).value).toBe(20);
  });
});
