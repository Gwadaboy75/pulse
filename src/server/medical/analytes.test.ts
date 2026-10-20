import { describe, expect, it } from "vitest";
import type { LabResultVM } from "../queries/types";
import { markerOf, normalizeResult, normalizeUnitText, parseLoq, pickMarkers } from "./analytes";

const row = (p: Partial<LabResultVM> & { analyte: string; label: string }): LabResultVM => ({
  id: 1,
  day: "2026-09-01",
  value: 1,
  valueText: null,
  unit: null,
  refLow: null,
  refHigh: null,
  refText: null,
  flag: null,
  labName: null,
  documentId: null,
  ...p,
});

describe("analyte aliases", () => {
  it("recognises French and English keys and printed labels", () => {
    expect(markerOf(row({ analyte: "crp", label: "CRP" }))).toBe("crp");
    expect(markerOf(row({ analyte: "proteine_c_reactive", label: "Protéine C réactive" }))).toBe("crp");
    expect(markerOf(row({ analyte: "x", label: "Phosphatases alcalines" }))).toBe("alp");
    expect(markerOf(row({ analyte: "vgm", label: "VGM" }))).toBe("mcv");
    expect(markerOf(row({ analyte: "glycemie_a_jeun", label: "Glycémie à jeun" }))).toBe("glucose");
    expect(markerOf(row({ analyte: "hemoglobin", label: "Hémoglobine" }))).toBeNull();
  });
});

describe("unit normalisation", () => {
  it("converts CRP mg/L to mg/dL, creatinine mg/dL to µmol/L, glucose mg/dL and g/L to mmol/L, albumin g/dL to g/L", () => {
    const crp = normalizeResult("crp", row({ analyte: "crp", label: "CRP", value: 3, unit: "mg/L" }));
    expect(crp.input).toMatchObject({ value: 0.3, unit: "mg/dL", from: { value: 3, unit: "mg/L" } });
    expect(normalizeResult("creatinine", row({ analyte: "creatinine", label: "Créatinine", value: 1, unit: "mg/dL" })).input!.value).toBeCloseTo(88.4, 5);
    expect(normalizeResult("glucose", row({ analyte: "glucose", label: "Glucose", value: 90, unit: "mg/dL" })).input!.value).toBeCloseTo(90 / 18.018, 5);
    expect(normalizeResult("glucose", row({ analyte: "glucose", label: "Glucose", value: 0.9, unit: "g/L" })).input!.value).toBeCloseTo(4.996, 3);
    expect(normalizeResult("albumin", row({ analyte: "albumin", label: "Albumine", value: 4.5, unit: "g/dL" })).input!.value).toBeCloseTo(45, 5);
    expect(normalizeResult("wbc", row({ analyte: "wbc", label: "Leucocytes", value: 5500, unit: "/mm³" })).input!.value).toBeCloseTo(5.5, 5);
    expect(normalizeResult("wbc", row({ analyte: "wbc", label: "Leucocytes", value: 5.5, unit: "G/L" })).input!.value).toBe(5.5);
    expect(normalizeResult("wbc", row({ analyte: "wbc", label: "Leucocytes", value: 5.5, unit: "x10^9/L" })).input!.value).toBe(5.5);
  });
  it("keeps a value already in the model unit, without a `from`", () => {
    const r = normalizeResult("creatinine", row({ analyte: "creatinine", label: "Créatinine", value: 80, unit: "µmol/L" }));
    expect(r.input).toEqual({ value: 80, unit: "µmol/L", day: "2026-09-01" });
    expect(normalizeUnitText("μmol / L")).toBe("umol/l");
  });
  it("refuses an unknown unit and the RDW-SD, naming the problem", () => {
    const r = normalizeResult("glucose", row({ analyte: "glucose", label: "Glucose", value: 5, unit: "mol/L" }));
    expect(r.input).toBeNull();
    expect(r.note).toMatch(/non reconnue/);
    expect(normalizeResult("rdw", row({ analyte: "rdw_sd", label: "RDW-SD", value: 42, unit: "fL" })).input).toBeNull();
    expect(normalizeResult("rdw", row({ analyte: "rdw", label: "IDR", value: 12.5, unit: "%" })).input!.value).toBe(12.5);
  });
  it("takes a '< x' result as half the limit, with the rule shown", () => {
    expect(parseLoq("< 0,3")).toBe(0.3);
    expect(parseLoq("<5")).toBe(5);
    expect(parseLoq("inf. à 0.6")).toBe(0.6);
    expect(parseLoq("négatif")).toBeNull();
    const r = normalizeResult("crp", row({ analyte: "crp", label: "CRP", value: null, valueText: "< 0,3", unit: "mg/L" }));
    expect(r.input).toMatchObject({ value: 0.015, unit: "mg/dL", rule: "loq_half" });
    expect(r.note).toMatch(/moitié/);
  });
  it("picks the latest result per marker and turns absolute lymphocytes into a percentage of the same day's white cells", () => {
    const picks = pickMarkers([
      row({ id: 3, analyte: "lymphocytes", label: "Lymphocytes", value: 1.8, unit: "G/L", day: "2026-09-01" }),
      row({ id: 2, analyte: "leucocytes", label: "Leucocytes", value: 6, unit: "G/L", day: "2026-09-01" }),
      row({ id: 1, analyte: "crp", label: "CRP", value: 1, unit: "mg/L", day: "2026-03-01" }),
      row({ id: 0, analyte: "crp", label: "CRP", value: 9, unit: "mg/L", day: "2025-03-01" }),
    ]);
    expect(picks.get("crp")!.result.id).toBe(1);
    expect(picks.get("lymphocytes")!.normalized.input).toMatchObject({ value: 30, unit: "%", rule: "absolute_to_percent" });
    expect(picks.get("wbc")!.normalized.input!.value).toBe(6);
  });
});
