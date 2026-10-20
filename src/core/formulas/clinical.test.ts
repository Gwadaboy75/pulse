import { describe, expect, it } from "vitest";
import { egfrCkdEpi2021, homaIr, nonHdl, tyg } from "./clinical";

describe("clinical calculators", () => {
  it("CKD-EPI 2021: a 40-year-old man at 1.0 mg/dL", () => {
    const r = egfrCkdEpi2021({ value: 1.0, unit: "mg/dL" }, 40, "male");
    expect(r.value).toBe(Math.round(142 * (1 / 0.9) ** -1.2 * 0.9938 ** 40));
  });
  it("CKD-EPI 2021: a woman below κ uses α and the 1.012 factor", () => {
    const r = egfrCkdEpi2021({ value: 0.6, unit: "mg/dL" }, 50, "female");
    expect(r.value).toBe(Math.round(142 * (0.6 / 0.7) ** -0.241 * 0.9938 ** 50 * 1.012));
  });
  it("CKD-EPI needs mg/dL", () => expect(egfrCkdEpi2021({ value: 88, unit: "µmol/L" }, 40, "male").missing).toEqual(["creatinine"]));
  it("non-HDL subtracts in the shared unit and refuses mixed units", () => {
    expect(nonHdl({ value: 5.2, unit: "mmol/L" }, { value: 1.4, unit: "mmol/L" }).value).toBe(3.8);
    expect(nonHdl({ value: 200, unit: "mg/dL" }, { value: 1.4, unit: "mmol/L" }).value).toBeNull();
  });
  it("TyG uses ln(TG × glucose / 2) in mg/dL", () => {
    expect(tyg({ value: 100, unit: "mg/dL" }, { value: 90, unit: "mg/dL" }).value).toBe(Math.round(Math.log(4500) * 100) / 100);
  });
  it("HOMA1-IR", () => expect(homaIr({ value: 5, unit: "mmol/L" }, { value: 9, unit: "µU/mL" }).value).toBe(2));
});
