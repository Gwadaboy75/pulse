// Clinical PhenoAge (Levine et al. 2018) from nine routine blood markers and age, as BioAge's original branch
// computes it (phenoage_calc.R, orig = TRUE): the full-precision coefficients, γ = 0.007692696, and the final
// denominator 0.090165. The 2019 erratum prints 0.09165; it is offered as a named variant, never silently.
// Units are the model's: the server converts (src/server/medical/analytes.ts) and this file refuses to guess.
import { FORMULAS } from "./registry";
import { type FormulaInput, type FormulaResult, result, round } from "./types";

export const PHENO_MARKERS = ["albumin", "creatinine", "glucose", "crp", "lymphocytes", "mcv", "rdw", "alp", "wbc"] as const;
export type PhenoMarker = (typeof PHENO_MARKERS)[number];

/** The unit each marker must be in before the regression. */
export const PHENO_UNITS: Record<PhenoMarker, string> = {
  albumin: "g/L",
  creatinine: "µmol/L",
  glucose: "mmol/L",
  crp: "mg/dL",
  lymphocytes: "%",
  mcv: "fL",
  rdw: "%",
  alp: "U/L",
  wbc: "10⁹/L",
};

export const PHENO_COEF: Record<PhenoMarker, number> = {
  albumin: -0.03359355,
  creatinine: 0.009506491,
  glucose: 0.1953192,
  /** Applied to ln(CRP in mg/dL). */
  crp: 0.09536762,
  lymphocytes: -0.01199984,
  mcv: 0.02676401,
  rdw: 0.3306156,
  alp: 0.001868778,
  wbc: 0.05542406,
};
export const PHENO_INTERCEPT = -19.90667;
export const PHENO_AGE_COEF = 0.08035356;
/** exp(120 × γ) − 1 for a 10-year (120-month) horizon. */
export const PHENO_T = 1.51714;
export const PHENO_GAMMA = 0.007692696;
export const PHENO_C = 141.50225;
export const PHENO_K = 0.0055305;

export const PHENO_VARIANTS = ["original", "erratum2019"] as const;
export type PhenoVariant = (typeof PHENO_VARIANTS)[number];
export const PHENO_DENOMINATOR: Record<PhenoVariant, number> = { original: 0.090165, erratum2019: 0.09165 };

export type PhenoInputs = Partial<Record<PhenoMarker, FormulaInput>>;

/** The linear predictor x over the nine markers (model units) and age. */
export function phenoLinear(m: Record<PhenoMarker, number>, ageYears: number): number {
  let x = PHENO_INTERCEPT + PHENO_AGE_COEF * ageYears;
  for (const k of PHENO_MARKERS) x += PHENO_COEF[k] * (k === "crp" ? Math.log(m.crp) : m[k]);
  return x;
}

/** 10-year mortality risk m from x (Gompertz). */
export const phenoMortality = (x: number): number => 1 - Math.exp((-PHENO_T * Math.exp(x)) / PHENO_GAMMA);

/** The published form, PhenoAge = C + ln(−K · ln(1 − m)) / d; loses precision as m nears 1. */
export const phenoAgeDirect = (x: number, variant: PhenoVariant = "original"): number =>
  PHENO_C + Math.log(-PHENO_K * Math.log(1 - phenoMortality(x))) / PHENO_DENOMINATOR[variant];

/** The algebraically equal stable form, C + [ln(K · T / γ) + x] / d. The one the result uses. */
export const phenoAgeStable = (x: number, variant: PhenoVariant = "original"): number => PHENO_C + (Math.log((PHENO_K * PHENO_T) / PHENO_GAMMA) + x) / PHENO_DENOMINATOR[variant];

export type PhenoAge = { x: number; mortality10y: number; phenoAge: number; /** PhenoAge − chronological age: a plain difference, not the residual "PhenoAgeAccel" of the papers. */ delta: number; variant: PhenoVariant };

/**
 * PhenoAge from converted inputs. Null with `missing` when a marker is absent; a CRP at or below zero is refused
 * (ln is undefined) with a note, never replaced.
 */
export function phenoAge(inputs: PhenoInputs, ageYears: number | null, variant: PhenoVariant = "original"): FormulaResult<PhenoAge> {
  const ref = FORMULAS["bioage.phenoage2018"];
  const used: Record<string, FormulaInput> = {};
  const missing: string[] = [];
  const notes: string[] = [];
  for (const k of PHENO_MARKERS) {
    const i = inputs[k];
    if (!i || !Number.isFinite(i.value)) {
      missing.push(k);
      continue;
    }
    if (i.unit !== PHENO_UNITS[k]) {
      missing.push(k);
      notes.push(`${k} : unité ${i.unit} au lieu de ${PHENO_UNITS[k]}.`);
      continue;
    }
    if (k === "crp" && i.value <= 0) {
      missing.push(k);
      notes.push("CRP nulle : le logarithme n’est pas défini ; saisissez la limite de quantification (« < 0,3 ») pour appliquer la règle.");
      continue;
    }
    used[k] = i;
  }
  if (ageYears == null || !Number.isFinite(ageYears)) missing.push("age");
  else used.age = { value: ageYears, unit: "ans" };
  notes.push(variant === "original" ? "Dénominateur 0,090165 (BioAge, modèle d’origine) ; l’erratum 2019 imprime 0,09165." : "Dénominateur 0,09165 (erratum PLoS Med 2019) ; le modèle d’origine utilise 0,090165.");
  if (missing.length) return result<PhenoAge>(ref, "ans", null, used, missing, notes);
  const m = Object.fromEntries(PHENO_MARKERS.map((k) => [k, used[k].value])) as Record<PhenoMarker, number>;
  const x = phenoLinear(m, ageYears as number);
  const p = phenoAgeStable(x, variant);
  return result<PhenoAge>(ref, "ans", { x, mortality10y: phenoMortality(x), phenoAge: round(p, 1), delta: round(p - (ageYears as number), 1), variant }, used, [], notes);
}

/** Years a 10× CRP entry error adds: ln(10) × coefficient / denominator (≈ 2.44 on the original). */
export const crpTenfoldYears = (variant: PhenoVariant = "original"): number => (Math.log(10) * PHENO_COEF.crp) / PHENO_DENOMINATOR[variant];
