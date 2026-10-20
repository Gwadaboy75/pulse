// From the lab results as entered (any key the extraction model or the person chose, the unit as printed) to the
// inputs the clinical formulas need (src/core/formulas/phenoage.ts, clinical.ts): which rows are which marker, the
// unit conversion each needs, and the rule for a "< x" result. A unit this file doesn't recognise makes the marker
// missing, with a note, rather than a guess (docs/formulas.md).
import { PHENO_MARKERS, PHENO_UNITS, type PhenoMarker } from "@/core/formulas/phenoage";
import type { FormulaInput } from "@/core/formulas/types";
import { analyteKey } from "./extraction";
import type { LabResultVM } from "../queries/types";

/** The markers the clinical calculators read, beyond PhenoAge's nine. */
export type Marker = PhenoMarker | "total_cholesterol" | "hdl" | "triglycerides" | "insulin";

/** Analyte keys and printed labels (French and English) recognised for each marker; matched after analyteKey(). */
export const ANALYTE_ALIASES: Record<Marker, string[]> = {
  albumin: ["albumin", "albumine", "albumine_serique", "serum_albumin"],
  creatinine: ["creatinine", "creatinine_serique", "serum_creatinine", "creat"],
  glucose: ["glucose", "glycemie", "glycemie_a_jeun", "glucose_fasting", "fasting_glucose", "glucose_a_jeun", "glycemie_veineuse"],
  crp: ["crp", "hs_crp", "hscrp", "crp_ultrasensible", "crp_us", "proteine_c_reactive", "c_reactive_protein", "crp_ultra_sensible"],
  lymphocytes: ["lymphocytes", "lymphocytes_pct", "lymphocyte_percent", "lymphocytes_percent", "lymph", "lymphocytes_relatifs"],
  mcv: ["mcv", "vgm", "volume_globulaire_moyen", "mean_corpuscular_volume"],
  rdw: ["rdw", "idr", "rdw_cv", "red_cell_distribution_width", "indice_de_distribution_des_globules_rouges", "idr_cv"],
  alp: ["alp", "pal", "phosphatases_alcalines", "phosphatase_alcaline", "alkaline_phosphatase"],
  wbc: ["wbc", "leucocytes", "globules_blancs", "white_blood_cells", "leukocytes", "leucocytes_totaux"],
  total_cholesterol: ["total_cholesterol", "cholesterol_total", "cholesterol", "cholesterol_totale"],
  hdl: ["hdl", "hdl_cholesterol", "cholesterol_hdl"],
  triglycerides: ["triglycerides", "triglycerides_tg", "tg"],
  insulin: ["insulin", "insuline", "insuline_a_jeun", "fasting_insulin", "insulinemie"],
};

const ALIAS_INDEX = new Map<string, Marker>();
for (const [m, keys] of Object.entries(ANALYTE_ALIASES) as [Marker, string[]][]) for (const k of keys) ALIAS_INDEX.set(k, m);

/** The marker a result belongs to, from its key or its printed label; null when it is none of them. */
export function markerOf(r: Pick<LabResultVM, "analyte" | "label">): Marker | null {
  return ALIAS_INDEX.get(r.analyte) ?? ALIAS_INDEX.get(analyteKey(r.label)) ?? null;
}

/** The unit each marker's calculator expects. */
export const MARKER_UNITS: Record<Marker, string> = {
  ...PHENO_UNITS,
  total_cholesterol: "",
  hdl: "",
  triglycerides: "mg/dL",
  insulin: "µU/mL",
};

/** A printed unit, normalised for matching: lowercase, no spaces, µ/u/μ alike, "x10^9/L" forms collapsed. */
export function normalizeUnitText(u: string | null): string {
  return (u ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[μµ]/g, "u")
    .replace(/litre|liter/g, "l")
    .replace(/\^|\*\*/g, "")
    .replace(/x10|×10|10e|10\^|10/g, "10")
    .replace(/g\/dl/g, "g/dl")
    .replace(/mmol\/l/g, "mmol/l")
    .replace(/\/mm3|\/mm³|\/ul|\/µl/g, "/ul")
    .replace(/giga\/l|g\/l(?=$)/g, "g/l");
}

type Conversion = { from: string[]; factor: number; label: string };

/**
 * Per marker: the accepted spellings of the model unit, and the conversions from other printed units. A unit absent
 * from both lists is unknown: the marker is then missing, never converted by guesswork.
 */
const CONVERSIONS: Record<Marker, { same: string[]; convert: Conversion[] }> = {
  albumin: { same: ["g/l"], convert: [{ from: ["g/dl"], factor: 10, label: "g/dL × 10" }] },
  creatinine: { same: ["umol/l"], convert: [{ from: ["mg/dl"], factor: 88.4, label: "mg/dL × 88,4" }, { from: ["mg/l"], factor: 8.84, label: "mg/L × 8,84" }] },
  glucose: { same: ["mmol/l"], convert: [{ from: ["mg/dl"], factor: 1 / 18.018, label: "mg/dL ÷ 18,018" }, { from: ["g/l"], factor: 5.551, label: "g/L × 5,551" }] },
  crp: { same: ["mg/dl"], convert: [{ from: ["mg/l"], factor: 0.1, label: "mg/L ÷ 10" }] },
  lymphocytes: { same: ["%"], convert: [] },
  mcv: { same: ["fl", "um3", "µm3", "μm3"], convert: [] },
  rdw: { same: ["%"], convert: [] },
  alp: { same: ["u/l", "ui/l", "iu/l"], convert: [] },
  wbc: { same: ["109/l", "g/l", "10e9/l", "k/ul", "10^9/l"], convert: [{ from: ["/ul", "/mm3", "cellules/ul", "cells/ul"], factor: 0.001, label: "/µL ÷ 1000" }] },
  total_cholesterol: { same: ["mmol/l", "mg/dl", "g/l"], convert: [] },
  hdl: { same: ["mmol/l", "mg/dl", "g/l"], convert: [] },
  triglycerides: { same: ["mg/dl"], convert: [{ from: ["mmol/l"], factor: 88.57, label: "mmol/L × 88,57" }, { from: ["g/l"], factor: 100, label: "g/L × 100" }] },
  insulin: { same: ["uu/ml", "uui/ml", "mu/l", "mui/l", "uiu/ml"], convert: [{ from: ["pmol/l"], factor: 1 / 6.945, label: "pmol/L ÷ 6,945" }] },
};

/** "< 0,3", "<5", "inf. à 0,3" → the limit of quantification, else null. */
export function parseLoq(text: string | null): number | null {
  if (!text) return null;
  const m = /^\s*(?:<|inf(?:érieur|erieur)?\.?\s*(?:à|a)?)\s*([\d.,]+)/i.exec(text);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Converted values rounded to 6 decimals, so 3 mg/L reads 0.3 mg/dL and not 0.30000000000000004. */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export type Normalized = { input: FormulaInput; note: string | null } | { input: null; note: string };

/**
 * One result as the marker's calculator needs it: converted to the model unit (with the printed value kept), a "< x"
 * result taken as half the limit (rule shown), an unknown unit or RDW given as SD refused with a note.
 */
export function normalizeResult(marker: Marker, r: LabResultVM): Normalized {
  const unitText = normalizeUnitText(r.unit);
  const target = MARKER_UNITS[marker];
  // Lipids: no conversion, both results must share a printed unit; keep the unit as printed.
  if (marker === "total_cholesterol" || marker === "hdl") {
    if (r.value == null) return { input: null, note: `${r.label} : résultat non numérique.` };
    return { input: { value: r.value, unit: unitText, day: r.day }, note: null };
  }
  const c = CONVERSIONS[marker];
  if (marker === "rdw" && (unitText === "fl" || /sd/.test(r.analyte) || /sd/i.test(r.label))) return { input: null, note: `${r.label} : c’est la RDW-SD (en fL) ; le modèle attend la RDW-CV en %.` };
  let value = r.value;
  let rule: string | undefined;
  if (value == null) {
    const loq = parseLoq(r.valueText);
    if (loq == null) return { input: null, note: `${r.label} : résultat non numérique.` };
    value = loq / 2;
    rule = "loq_half";
  }
  const same = c.same.includes(unitText) || (c.same.includes("%") && unitText === "%");
  if (same || (!unitText && c.same.includes("%") && marker !== "lymphocytes")) {
    return { input: { value, unit: target, day: r.day, ...(rule && { rule, from: { value: r.value ?? value, unit: r.unit ?? "" } }) }, note: rule ? `${r.label} : sous la limite de quantification, prise à la moitié (${r.valueText}).` : null };
  }
  const conv = c.convert.find((x) => x.from.includes(unitText));
  if (conv) {
    return {
      input: { value: round6(value * conv.factor), unit: target, day: r.day, from: { value: r.value ?? value, unit: r.unit ?? "" }, ...(rule && { rule }) },
      note: rule ? `${r.label} : sous la limite de quantification, prise à la moitié (${r.valueText}), puis ${conv.label}.` : null,
    };
  }
  return { input: null, note: `${r.label} : unité « ${r.unit ?? "?"} » non reconnue ; attendu ${target || "la même unité"}.` };
}

export type MarkerPick = { marker: Marker; result: LabResultVM; normalized: Normalized };

/**
 * The latest result for each marker among `results` (newest first as getLabResults returns them), with lymphocytes
 * given as an absolute count turned into a percentage when the white-cell count of the same day exists.
 */
export function pickMarkers(results: LabResultVM[]): Map<Marker, MarkerPick> {
  const out = new Map<Marker, MarkerPick>();
  for (const r of results) {
    const m = markerOf(r);
    if (!m || out.has(m)) continue;
    out.set(m, { marker: m, result: r, normalized: normalizeResult(m, r) });
  }
  const lym = out.get("lymphocytes");
  if (lym && lym.normalized.input == null && lym.result.value != null) {
    // An absolute count (10⁹/L or /µL): a percentage of the same day's white cells.
    const u = normalizeUnitText(lym.result.unit);
    const wbcSameDay = results.find((r) => markerOf(r) === "wbc" && r.day === lym.result.day);
    const wbc = wbcSameDay ? normalizeResult("wbc", wbcSameDay) : null;
    const abs = CONVERSIONS.wbc.same.includes(u) ? lym.result.value : CONVERSIONS.wbc.convert.some((c) => c.from.includes(u)) ? lym.result.value * 0.001 : null;
    if (abs != null && wbc?.input && wbc.input.value > 0) {
      out.set("lymphocytes", {
        ...lym,
        normalized: { input: { value: round6((100 * abs) / wbc.input.value), unit: "%", day: lym.result.day, from: { value: lym.result.value, unit: lym.result.unit ?? "" }, rule: "absolute_to_percent" }, note: `${lym.result.label} : nombre absolu converti en % des leucocytes du même jour.` },
      });
    }
  }
  return out;
}

export const PHENO_MARKER_LIST: readonly PhenoMarker[] = PHENO_MARKERS;
