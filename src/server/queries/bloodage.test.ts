import { beforeAll, describe, expect, it } from "vitest";
import { CALC_DEFAULTS } from "../calc";
import type { Db } from "../db";
import { labResults, profile } from "../db/schema";
import { addUser, ctxFor, freshDb, NOW, TZ, USER } from "../testing";
import { medicalTools } from "../coach/medicalTools";
import { getBloodAge, getClinical } from "./medical";

/** A full panel as a French lab prints it: CRP in mg/L, creatinine in mg/dL, glucose in g/L, albumin in g/L, counts in G/L. */
const PANEL = [
  { analyte: "albumine", label: "Albumine", value: 45, unit: "g/L" },
  { analyte: "creatinine", label: "Créatinine", value: 0.9, unit: "mg/dL" },
  { analyte: "glycemie_a_jeun", label: "Glycémie à jeun", value: 0.9, unit: "g/L" },
  { analyte: "crp", label: "CRP ultrasensible", value: 0.5, unit: "mg/L" },
  { analyte: "lymphocytes", label: "Lymphocytes", value: 32, unit: "%" },
  { analyte: "vgm", label: "VGM", value: 88, unit: "fL" },
  { analyte: "idr", label: "IDR", value: 12.5, unit: "%" },
  { analyte: "phosphatases_alcalines", label: "Phosphatases alcalines", value: 60, unit: "U/L" },
  { analyte: "leucocytes", label: "Leucocytes", value: 5.5, unit: "G/L" },
];

let db: Db;
beforeAll(async () => {
  db = await freshDb();
  await db.insert(profile).values({ userId: USER, birthDate: "1986-06-15", sex: "male", timeZone: TZ, updatedAt: NOW });
  await db.insert(labResults).values(PANEL.map((p) => ({ userId: USER, day: "2026-09-10", createdAt: NOW, ...p })));
  // Lipids and insulin for the derived calculators.
  await db.insert(labResults).values([
    { userId: USER, day: "2026-09-10", analyte: "cholesterol_total", label: "Cholestérol total", value: 1.9, unit: "g/L", createdAt: NOW },
    { userId: USER, day: "2026-09-10", analyte: "hdl", label: "HDL", value: 0.6, unit: "g/L", createdAt: NOW },
    { userId: USER, day: "2026-09-10", analyte: "triglycerides", label: "Triglycérides", value: 0.8, unit: "g/L", createdAt: NOW },
    { userId: USER, day: "2026-09-10", analyte: "insuline", label: "Insuline à jeun", value: 6, unit: "µU/mL", createdAt: NOW },
  ]);
  // Another user's panel, which must never show.
  const other = await addUser(db);
  await db.insert(labResults).values(PANEL.map((p) => ({ userId: other, day: "2026-09-10", createdAt: NOW, ...p, value: p.value * 3 })));
});

describe("getBloodAge", () => {
  it("converts every printed unit to the model's and computes PhenoAge with its delta", async () => {
    const vm = await getBloodAge(ctxFor(db));
    expect(vm.result.value).not.toBeNull();
    const by = Object.fromEntries(vm.markers.map((m) => [m.marker, m]));
    expect(by.crp.converted).toMatchObject({ value: 0.05, unit: "mg/dL", from: { value: 0.5, unit: "mg/L" } });
    expect(by.creatinine.converted!.value).toBeCloseTo(79.56, 2);
    expect(by.glucose.converted!.value).toBeCloseTo(4.996, 3);
    expect(by.albumin.converted).toEqual({ value: 45, unit: "g/L", day: "2026-09-10" });
    expect(vm.drawDay).toBe("2026-09-10");
    expect(vm.stale).toBe(false);
    // The context's profile (testing.ts PROFILE) is born 1990-01-01: the delta is against that age, fractional.
    expect(Math.abs(vm.result.value!.delta - (vm.result.value!.phenoAge - vm.age))).toBeLessThan(1);
    expect(vm.notes[0]).toMatch(/0,090165/);
  });

  it("the erratum variant adds about 1.5 years at this age", async () => {
    const a = (await getBloodAge(ctxFor(db))).result.value!.phenoAge;
    const b = (await getBloodAge({ ...ctxFor(db), calc: { ...CALC_DEFAULTS, phenoageVariant: "erratum2019" } })).result.value!.phenoAge;
    expect(b - a).toBeGreaterThan(1.2);
    expect(b - a).toBeLessThan(2.1);
  });

  it("a missing marker leaves the age null and names it; a stale marker makes it provisional", async () => {
    const other = await addUser(db);
    await db.insert(profile).values({ userId: other, birthDate: "1986-06-15", sex: "male", timeZone: TZ, updatedAt: NOW });
    await db.insert(labResults).values(PANEL.filter((p) => p.analyte !== "crp").map((p) => ({ userId: other, day: "2026-09-10", createdAt: NOW, ...p })));
    const vm = await getBloodAge(ctxFor(db, undefined, other));
    expect(vm.result.value).toBeNull();
    expect(vm.markers.find((m) => m.marker === "crp")!.converted).toBeNull();
    await db.insert(labResults).values({ userId: other, day: "2025-01-10", analyte: "crp", label: "CRP", value: 1, unit: "mg/L", createdAt: NOW });
    const now = await getBloodAge(ctxFor(db, undefined, other));
    expect(now.result.value).not.toBeNull();
    expect(now.result.provisional).toBe(true);
    expect(now.stale).toBe(true);
  });

  it("the derived calculators use the file's results in their own units", async () => {
    const vm = await getClinical(ctxFor(db));
    const by = Object.fromEntries(vm.map((c) => [c.id, c]));
    expect(by["clinical.egfrCkdEpi2021"].result.value).toBeGreaterThan(90);
    expect(by["clinical.nonHdl"].result.value).toBeCloseTo(1.3, 6);
    expect(by["clinical.tyg"].result.value).toBeCloseTo(Math.log((80 * 90) / 2), 1);
    expect(by["clinical.homaIr"].result.value).toBeCloseTo((4.996 * 6) / 22.5, 1);
  });

  it("the coach's get_blood_age tool reads the same thing", async () => {
    const t = medicalTools(ctxFor(db));
    const out = (await t.get_blood_age.execute!({}, { toolCallId: "t", messages: [] } as never)) as { phenoAge: number | null; markers: { marker: string; used: unknown }[] };
    expect(out.phenoAge).not.toBeNull();
    expect(out.markers).toHaveLength(9);
    expect(out.markers.every((m) => m.used !== null)).toBe(true);
  });
});
