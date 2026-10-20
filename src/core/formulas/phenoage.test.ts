import { describe, expect, it } from "vitest";
import type { FormulaInput } from "./types";
import { crpTenfoldYears, PHENO_C, PHENO_DENOMINATOR, PHENO_MARKERS, type PhenoMarker, phenoAge, phenoAgeDirect, phenoAgeStable, phenoLinear } from "./phenoage";

const i = (value: number, unit: string): FormulaInput => ({ value, unit });

/** A healthy-looking panel in the model's units. */
const panel: Record<PhenoMarker, FormulaInput> = {
  albumin: i(45, "g/L"),
  creatinine: i(80, "µmol/L"),
  glucose: i(5.0, "mmol/L"),
  crp: i(0.05, "mg/dL"),
  lymphocytes: i(32, "%"),
  mcv: i(88, "fL"),
  rdw: i(12.5, "%"),
  alp: i(60, "U/L"),
  wbc: i(5.5, "10⁹/L"),
};
const values = Object.fromEntries(PHENO_MARKERS.map((k) => [k, panel[k].value])) as Record<PhenoMarker, number>;

describe("PhenoAge (Levine 2018, BioAge original branch)", () => {
  it("the stable form equals the published form", () => {
    // Real panels sit around x ≈ −12 … −5 (PhenoAge 10 … 90).
    for (const x of [-12, -9, -7, -5]) {
      expect(phenoAgeStable(x)).toBeCloseTo(phenoAgeDirect(x), 6);
      expect(phenoAgeStable(x, "erratum2019")).toBeCloseTo(phenoAgeDirect(x, "erratum2019"), 6);
    }
    // Where m rounds to 1 the published form has no digits left in ln(1 − m); the stable form is the one kept.
    expect(Number.isFinite(phenoAgeDirect(0))).toBe(false);
    expect(Number.isFinite(phenoAgeStable(0))).toBe(true);
  });
  it("a CRP entered ten times too high adds 2.4355 years (ln 10 × 0.09536762 / 0.090165)", () => {
    expect(crpTenfoldYears()).toBeCloseTo(2.43545, 4);
    const a = phenoAge(panel, 40).value!.phenoAge;
    const b = phenoAge({ ...panel, crp: i(0.5, "mg/dL") }, 40).value!.phenoAge;
    expect(b - a).toBeCloseTo(2.44, 1);
  });
  it("the erratum denominator adds +1.81 y at 30, +1.48 at 50, +1.16 at 70", () => {
    const shift = (p: number) => PHENO_C + ((p - PHENO_C) * PHENO_DENOMINATOR.original) / PHENO_DENOMINATOR.erratum2019 - p;
    expect(shift(30)).toBeCloseTo(1.81, 2);
    expect(shift(50)).toBeCloseTo(1.48, 2);
    expect(shift(70)).toBeCloseTo(1.16, 2);
    // The same shift through the function: x giving PhenoAge 50 on the original.
    const x = (50 - PHENO_C) * PHENO_DENOMINATOR.original - Math.log((0.0055305 * 1.51714) / 0.007692696);
    expect(phenoAgeStable(x, "erratum2019") - phenoAgeStable(x)).toBeCloseTo(1.48, 2);
  });
  it("the linear predictor sums the published coefficients", () => {
    const x = phenoLinear(values, 40);
    const expected =
      -19.90667 -
      0.03359355 * 45 +
      0.009506491 * 80 +
      0.1953192 * 5 +
      0.09536762 * Math.log(0.05) -
      0.01199984 * 32 +
      0.02676401 * 88 +
      0.3306156 * 12.5 +
      0.001868778 * 60 +
      0.05542406 * 5.5 +
      0.08035356 * 40;
    expect(x).toBeCloseTo(expected, 10);
  });
  it("a complete panel gives an age with its simple delta, and marks the variant", () => {
    const r = phenoAge(panel, 40);
    expect(r.value).not.toBeNull();
    expect(r.value!.delta).toBeCloseTo(r.value!.phenoAge - 40, 6);
    expect(r.value!.variant).toBe("original");
    expect(r.inputs.age).toEqual({ value: 40, unit: "ans" });
    expect(r.notes[0]).toMatch(/0,090165/);
  });
  it("a missing or wrongly-united marker gives null and names it", () => {
    const { crp: _, ...rest } = panel;
    void _;
    const r = phenoAge(rest, 40);
    expect(r.value).toBeNull();
    expect(r.missing).toEqual(["crp"]);
    const u = phenoAge({ ...panel, glucose: i(90, "mg/dL") }, 40);
    expect(u.missing).toEqual(["glucose"]);
    expect(u.notes.some((n) => /mg\/dL au lieu de mmol\/L/.test(n))).toBe(true);
  });
  it("a zero CRP is refused rather than logged", () => {
    const r = phenoAge({ ...panel, crp: i(0, "mg/dL") }, 40);
    expect(r.value).toBeNull();
    expect(r.missing).toEqual(["crp"]);
  });
  it("needs the age", () => expect(phenoAge(panel, null).missing).toEqual(["age"]));
});
