// Small clinical calculators on lab results (docs/formulas.md): CKD-EPI 2021 eGFR, non-HDL cholesterol, the TyG
// index and HOMA1-IR. Inputs are in the equation's units; the server converts and names the conversion.
import { FORMULAS } from "./registry";
import { type FormulaInput, type FormulaResult, type Sex, result, round } from "./types";

/** CKD-EPI 2021 creatinine equation, mL/min/1.73 m²; creatinine in mg/dL. */
export function egfrCkdEpi2021(creatinine: FormulaInput | null, ageYears: number | null, sex: Sex): FormulaResult {
  const ref = FORMULAS["clinical.egfrCkdEpi2021"];
  const inputs: Record<string, FormulaInput> = {};
  const missing: string[] = [];
  if (!creatinine || creatinine.unit !== "mg/dL") missing.push("creatinine");
  else inputs.creatinine = creatinine;
  if (ageYears == null) missing.push("age");
  else inputs.age = { value: ageYears, unit: "ans" };
  if (missing.length) return result(ref, "mL/min/1,73 m²", null, inputs, missing);
  const female = sex === "female";
  const k = female ? 0.7 : 0.9;
  const a = female ? -0.241 : -0.302;
  const r = (creatinine as FormulaInput).value / k;
  const value = 142 * Math.min(r, 1) ** a * Math.max(r, 1) ** -1.2 * 0.9938 ** (ageYears as number) * (female ? 1.012 : 1);
  return result(ref, "mL/min/1,73 m²", round(value), inputs);
}

/** Total cholesterol − HDL, in the printed unit when both share it. */
export function nonHdl(total: FormulaInput | null, hdl: FormulaInput | null): FormulaResult {
  const ref = FORMULAS["clinical.nonHdl"];
  const inputs: Record<string, FormulaInput> = {};
  const missing: string[] = [];
  if (!total) missing.push("totalCholesterol");
  else inputs.totalCholesterol = total;
  if (!hdl) missing.push("hdl");
  else inputs.hdl = hdl;
  if (missing.length) return result(ref, "", null, inputs, missing);
  if ((total as FormulaInput).unit !== (hdl as FormulaInput).unit) return result(ref, "", null, inputs, ["hdl"], ["Unités différentes entre cholestérol total et HDL."]);
  return result(ref, (total as FormulaInput).unit, round((total as FormulaInput).value - (hdl as FormulaInput).value, 2), inputs);
}

/** TyG = ln(triglycerides × glucose / 2), both in mg/dL. */
export function tyg(triglycerides: FormulaInput | null, glucose: FormulaInput | null): FormulaResult {
  const ref = FORMULAS["clinical.tyg"];
  const inputs: Record<string, FormulaInput> = {};
  const missing: string[] = [];
  if (!triglycerides || triglycerides.unit !== "mg/dL") missing.push("triglycerides");
  else inputs.triglycerides = triglycerides;
  if (!glucose || glucose.unit !== "mg/dL") missing.push("glucose");
  else inputs.glucose = glucose;
  if (missing.length) return result(ref, "", null, inputs, missing);
  const t = (triglycerides as FormulaInput).value;
  const g = (glucose as FormulaInput).value;
  if (t <= 0 || g <= 0) return result(ref, "", null, inputs, ["glucose"], ["Valeur nulle : le logarithme n’est pas défini."]);
  return result(ref, "", round(Math.log((t * g) / 2), 2), inputs, [], ["Convention ln(TG × glucose / 2)."]);
}

/** HOMA1-IR = glucose (mmol/L) × fasting insulin (µU/mL) / 22.5. */
export function homaIr(glucose: FormulaInput | null, insulin: FormulaInput | null): FormulaResult {
  const ref = FORMULAS["clinical.homaIr"];
  const inputs: Record<string, FormulaInput> = {};
  const missing: string[] = [];
  if (!glucose || glucose.unit !== "mmol/L") missing.push("glucose");
  else inputs.glucose = glucose;
  if (!insulin || insulin.unit !== "µU/mL") missing.push("insulin");
  else inputs.insulin = insulin;
  if (missing.length) return result(ref, "", null, inputs, missing);
  return result(ref, "", round(((glucose as FormulaInput).value * (insulin as FormulaInput).value) / 22.5, 2), inputs);
}
