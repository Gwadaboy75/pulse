// Resting metabolism (RMR, kcal/day) by the published prediction equations, total daily energy expenditure (TDEE) by
// activity multipliers or the 2023 EER equations, and MET energy. Every number is the publication's (docs/formulas.md);
// an equation out of its domain still computes, with a note saying so. Nothing here is a measurement.
import { FORMULAS } from "./registry";
import { type FormulaInput, type FormulaResult, type Sex, result, round } from "./types";

export const RMR_EQUATIONS = [
  "mifflin1990",
  "harrisBenedict1919",
  "rozaShizgal1984",
  "cunningham1980",
  "cunningham1991",
  "owen1987",
  "schofield1985",
  "henryOxford2005",
  "tenHaaf2014",
  "tenHaaf2014Ffm",
] as const;
export type RmrEquation = (typeof RMR_EQUATIONS)[number];

export type RmrInputs = {
  weightKg: number | null;
  heightCm: number | null;
  ageYears: number | null;
  sex: Sex;
  /** Fat-free mass; null when there is no body-fat reading to derive it from. */
  ffmKg: number | null;
};

export const KCAL_PER_MJ = 239.006;

/** Which of the inputs an equation reads. */
export const RMR_NEEDS: Record<RmrEquation, (keyof RmrInputs)[]> = {
  mifflin1990: ["weightKg", "heightCm", "ageYears", "sex"],
  harrisBenedict1919: ["weightKg", "heightCm", "ageYears", "sex"],
  rozaShizgal1984: ["weightKg", "heightCm", "ageYears", "sex"],
  cunningham1980: ["ffmKg"],
  cunningham1991: ["ffmKg"],
  owen1987: ["weightKg", "sex"],
  schofield1985: ["weightKg", "ageYears", "sex"],
  henryOxford2005: ["weightKg", "ageYears", "sex"],
  tenHaaf2014: ["weightKg", "heightCm", "ageYears", "sex"],
  tenHaaf2014Ffm: ["ffmKg"],
};

/**
 * The age band of the weight-only tables (Schofield, Henry). The published bands overlap at 30 and 60; here the band
 * changes on the birthday: 30 is in 30–60, 60 is in 60 and over.
 */
export const ageBand = (age: number): 0 | 1 | 2 => (age < 30 ? 0 : age < 60 ? 1 : 2);

/** Schofield (1985), weight only, kcal/day, [slope, intercept] by band. */
export const SCHOFIELD: Record<Sex, [number, number][]> = {
  male: [
    [15.057, 692.2],
    [11.472, 873.1],
    [11.711, 587.7],
  ],
  female: [
    [14.818, 486.6],
    [8.126, 845.6],
    [9.082, 658.5],
  ],
};

/** Henry (2005, the Oxford equations), weight only, MJ/day as published (table 12), [slope, intercept] by band. */
export const HENRY_MJ: Record<Sex, [number, number][]> = {
  male: [
    [0.0669, 2.28],
    [0.0592, 2.48],
    [0.0563, 2.15],
  ],
  female: [
    [0.0546, 2.33],
    [0.0407, 2.9],
    [0.0424, 2.38],
  ],
};

function compute(eq: RmrEquation, i: Required<{ [K in keyof RmrInputs]: NonNullable<RmrInputs[K]> }>): number {
  const { weightKg: P, heightCm: T, ageYears: A, sex, ffmKg: F } = i;
  const male = sex === "male";
  switch (eq) {
    case "mifflin1990":
      return 10 * P + 6.25 * T - 5 * A + (male ? 5 : -161);
    case "harrisBenedict1919":
      return male ? 66.473 + 13.7516 * P + 5.0033 * T - 6.755 * A : 655.0955 + 9.5634 * P + 1.8496 * T - 4.6756 * A;
    case "rozaShizgal1984":
      return male ? 88.362 + 13.397 * P + 4.799 * T - 5.677 * A : 447.593 + 9.247 * P + 3.098 * T - 4.33 * A;
    case "cunningham1980":
      return 500 + 22 * F;
    case "cunningham1991":
      return 370 + 21.6 * F;
    case "owen1987":
      return male ? 879 + 10.2 * P : 795 + 7.18 * P;
    case "schofield1985": {
      const [k, c] = SCHOFIELD[sex][ageBand(A)];
      return k * P + c;
    }
    case "henryOxford2005": {
      const [k, c] = HENRY_MJ[sex][ageBand(A)];
      return (k * P + c) * KCAL_PER_MJ;
    }
    case "tenHaaf2014":
      return 11.936 * P + 587.728 * (T / 100) - 8.129 * A + 191.027 * (male ? 1 : 0) + 29.279;
    case "tenHaaf2014Ffm":
      return 22.771 * F + 484.264;
  }
}

/** Domain notes an equation adds for these inputs (empty when the inputs sit inside its derivation population). */
export function rmrNotes(eq: RmrEquation, i: RmrInputs): string[] {
  const notes: string[] = [];
  const age = i.ageYears;
  if (age != null && age < 18 && eq !== "schofield1985" && eq !== "henryOxford2005") notes.push("Équation dérivée chez l’adulte : hors domaine avant 18 ans.");
  if (age != null && age < 18 && (eq === "schofield1985" || eq === "henryOxford2005")) notes.push("Tranche 18–30 ans appliquée : les tables publient des tranches enfants que Pulse ne reprend pas.");
  if ((eq === "tenHaaf2014" || eq === "tenHaaf2014Ffm") && age != null && (age < 18 || age > 35)) notes.push("Dérivée chez des sportifs de 18 à 35 ans : hors domaine à cet âge.");
  if (eq === "tenHaaf2014" || eq === "tenHaaf2014Ffm") notes.push("Population : 90 sportifs récréatifs néerlandais (≈ 9 h/semaine).");
  if (eq === "harrisBenedict1919") notes.push("Surestime le repos d’environ 10 à 15 % chez l’adulte actuel ; gardée pour comparaison.");
  if (eq === "schofield1985") notes.push("Base comptant près de la moitié de sujets italiens au métabolisme élevé : tend à surestimer.");
  if (eq === "owen1987") notes.push("Sédentaires américains, petits échantillons : sous-estime les sportifs.");
  if ((eq === "cunningham1980" || eq === "cunningham1991" || eq === "tenHaaf2014Ffm") && i.ffmKg != null) notes.push("La masse maigre vient d’une balance (impédance) : son erreur se répercute directement.");
  return notes;
}

/** One equation on the inputs; `value` is null, with `missing` filled, when it lacks an input. */
export function rmr(eq: RmrEquation, i: RmrInputs): FormulaResult {
  const ref = FORMULAS[`rmr.${eq}`];
  const inputs: Record<string, FormulaInput> = {};
  const missing: string[] = [];
  const UNIT: Record<keyof RmrInputs, string> = { weightKg: "kg", heightCm: "cm", ageYears: "ans", sex: "", ffmKg: "kg" };
  for (const k of RMR_NEEDS[eq]) {
    const v = i[k];
    if (k === "sex") continue;
    if (v == null || typeof v !== "number" || !Number.isFinite(v)) missing.push(k);
    else inputs[k] = { value: v, unit: UNIT[k] };
  }
  if (missing.length) return result(ref, "kcal/j", null, inputs, missing, rmrNotes(eq, i));
  const full = { weightKg: i.weightKg ?? 0, heightCm: i.heightCm ?? 0, ageYears: i.ageYears ?? 0, sex: i.sex, ffmKg: i.ffmKg ?? 0 };
  return result(ref, "kcal/j", round(compute(eq, full)), inputs, [], rmrNotes(eq, i));
}

/** Fat-free mass from weight and body-fat percentage. */
export const fatFreeMass = (weightKg: number, bodyFatPct: number): number => weightKg * (1 - bodyFatPct / 100);

// ── Total daily energy expenditure ───────────────────────────────────────────

export const ACTIVITY_LEVELS = ["inactive", "low_active", "active", "very_active"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** The conventional activity multipliers (not a property of the person; a convention to compare against). */
export const PAL: Record<ActivityLevel, number> = { inactive: 1.2, low_active: 1.375, active: 1.55, very_active: 1.725 };

export function tdeePal(rmrKcal: number, level: ActivityLevel): FormulaResult {
  const ref = FORMULAS["tdee.pal"];
  return result(ref, "kcal/j", round(rmrKcal * PAL[level]), { rmr: { value: rmrKcal, unit: "kcal/j" }, pal: { value: PAL[level], unit: "×" } }, [], [
    "Multiplicateur conventionnel : ajouter les calories d’une séance à ce total les compterait deux fois.",
  ]);
}

/**
 * Estimated Energy Requirement, DRI 2023, adults 19 and over: a total maintenance requirement from doubly-labelled
 * water, not a resting rate. [intercept, age, height cm, weight kg] by sex and level.
 */
export const EER_2023: Record<Sex, Record<ActivityLevel, [number, number, number, number]>> = {
  male: {
    inactive: [753.07, -10.83, 6.5, 14.1],
    low_active: [581.47, -10.83, 8.3, 14.94],
    active: [1004.82, -10.83, 6.52, 15.91],
    very_active: [-517.88, -10.83, 15.61, 19.11],
  },
  female: {
    inactive: [584.9, -7.01, 5.72, 11.71],
    low_active: [575.77, -7.01, 6.6, 12.14],
    active: [710.25, -7.01, 6.54, 12.34],
    very_active: [511.83, -7.01, 9.07, 12.56],
  },
};

export function eer2023(sex: Sex, level: ActivityLevel, i: { weightKg: number | null; heightCm: number | null; ageYears: number | null }): FormulaResult {
  const ref = FORMULAS["tdee.eer2023"];
  const inputs: Record<string, FormulaInput> = {};
  const missing: string[] = [];
  for (const [k, unit] of [
    ["weightKg", "kg"],
    ["heightCm", "cm"],
    ["ageYears", "ans"],
  ] as const) {
    const v = i[k];
    if (v == null || !Number.isFinite(v)) missing.push(k);
    else inputs[k] = { value: v, unit };
  }
  const notes = i.ageYears != null && i.ageYears < 19 ? ["Équations adultes (19 ans et plus) : hors domaine à cet âge."] : [];
  if (missing.length) return result(ref, "kcal/j", null, inputs, missing, notes);
  const [c, a, h, w] = EER_2023[sex][level];
  const value = c + a * (i.ageYears as number) + h * (i.heightCm as number) + w * (i.weightKg as number);
  return result(ref, "kcal/j", round(value), inputs, [], notes);
}

/** Energy of an activity from its MET value: 1 MET = 3.5 mL O2/kg/min, about 5 kcal per litre of O2. */
export function metKcal(met: number, weightKg: number, minutes: number, net = false): FormulaResult {
  const ref = FORMULAS["energy.met"];
  const effective = net ? met - 1 : met;
  const value = ((effective * 3.5 * weightKg) / 200) * minutes;
  return result(ref, "kcal", round(Math.max(0, value)), { met: { value: met, unit: "MET" }, weightKg: { value: weightKg, unit: "kg" }, minutes: { value: minutes, unit: "min" } }, [], [
    net ? "Dépense nette : le repos (1 MET) est retiré." : "Dépense brute : inclut le repos pendant l’activité.",
  ]);
}

/**
 * "Metabolic age": the age at which the simplified Mifflin-St Jeor equation would give this resting rate for the same
 * weight, height and sex. An algebraic inversion for comparison, not a validated clock (docs/formulas.md).
 */
export function metabolicAge(rmrKcal: number, i: { weightKg: number; heightCm: number; sex: Sex }): FormulaResult {
  const ref = FORMULAS["age.metabolic"];
  const c = i.sex === "male" ? 5 : -161;
  const value = (10 * i.weightKg + 6.25 * i.heightCm + c - rmrKcal) / 5;
  return result(ref, "ans", round(value, 1), { rmr: { value: rmrKcal, unit: "kcal/j" }, weightKg: { value: i.weightKg, unit: "kg" }, heightCm: { value: i.heightCm, unit: "cm" } }, [], [
    "Inversion de Mifflin-St Jeor : une comparaison avec la table, pas une horloge biologique.",
  ]);
}
