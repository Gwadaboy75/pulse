// A personal HRV reference on lnRMSSD, shown beside Recovery without changing it: the last nights' trend against a
// reference built from the nights before (never the night evaluated), with a ±0.5 σ band (the "smallest worthwhile
// change" of Plews & Buchheit) and the night-to-night coefficient of variation. Three ways to build the reference,
// chosen in Settings › Calculs; the windows are design parameters, said as such on the screen.
import { foldHistory, metricCfg, sigma } from "../scoring/baselines";
import { FORMULAS } from "./registry";
import { type FormulaResult, result, round } from "./types";

export const HRV_REFERENCE_METHODS = ["ewma", "mean_sd", "median_mad"] as const;
export type HrvReferenceMethod = (typeof HRV_REFERENCE_METHODS)[number];

export const TREND_NIGHTS = 7;
/** Valid nights the trend and the CV need, out of the last 7. */
export const MIN_TREND_NIGHTS = 4;
/** Valid nights the reference needs. */
export const MIN_REFERENCE_NIGHTS = 7;
export const BAND_SIGMAS = 0.5;
/** σ never below this (ln ms): keeps the band and z finite on a flat series. Same floor as the readiness ln config. */
export const SIGMA_FLOOR = metricCfg.readiness_hrv_ln.floorSpread;
const MAD_TO_SIGMA = 1.4826;

export type HrvNight = { day: string; hrvMs: number | null };

export type Reference = { center: number; sigma: number; valid: number; method: HrvReferenceMethod };

const lnOf = (ms: number | null): number | null => (ms != null && ms > 0 && Number.isFinite(ms) ? Math.log(ms) : null);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** The reference from `lns` (the nights before the one evaluated, oldest first, nulls = missing). */
export function reference(lns: (number | null)[], method: HrvReferenceMethod): Reference | null {
  const valid = lns.filter((v): v is number => v != null);
  if (valid.length < MIN_REFERENCE_NIGHTS) return null;
  if (method === "ewma") {
    const s = foldHistory(lns, metricCfg.readiness_hrv_ln, false);
    return { center: s.baseline, sigma: Math.max(sigma(s), SIGMA_FLOOR), valid: s.nValid, method };
  }
  if (method === "median_mad") {
    const m = median(valid);
    const mad = median(valid.map((v) => Math.abs(v - m)));
    return { center: m, sigma: Math.max(MAD_TO_SIGMA * mad, SIGMA_FLOOR), valid: valid.length, method };
  }
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const sd = Math.sqrt(valid.reduce((a, x) => a + (x - mean) ** 2, 0) / (valid.length - 1));
  return { center: mean, sigma: Math.max(sd, SIGMA_FLOOR), valid: valid.length, method };
}

export type HrvPoint = { day: string; ln: number | null; ms: number | null; lo: number | null; hi: number | null };

export type HrvPanel = {
  method: HrvReferenceMethod;
  referenceDays: number;
  /** The last night with a value within the window, in ms and ln. */
  latest: { day: string; ms: number; ln: number } | null;
  /** Mean lnRMSSD over the last 7 nights (≥ 4 valid), with the ms it corresponds to. */
  trend: { ln: number; ms: number; valid: number } | null;
  reference: (Reference & { ms: number; lo: number; hi: number }) | null;
  /** The latest night's standardized deviation from the reference. */
  z: number | null;
  /** Coefficient of variation of lnRMSSD over the last 7 nights, %. */
  cv7: number | null;
  /** One point per day of the series, with the band each night was judged against (built from the nights before it). */
  points: HrvPoint[];
};

/**
 * `nights` oldest first, the last one being the day evaluated; the reference for each night uses the `referenceDays`
 * nights before it. Returns a FormulaResult whose value is null when fewer than 7 reference nights exist.
 */
export function hrvPanel(nights: HrvNight[], opts: { method: HrvReferenceMethod; referenceDays: number }): FormulaResult<HrvPanel> {
  const ref = FORMULAS["hrv.reference"];
  const lns = nights.map((n) => lnOf(n.hrvMs));
  const points: HrvPoint[] = nights.map((n, i) => {
    const r = reference(lns.slice(Math.max(0, i - opts.referenceDays), i), opts.method);
    return { day: n.day, ln: lns[i], ms: lns[i] == null ? null : n.hrvMs, lo: r ? r.center - BAND_SIGMAS * r.sigma : null, hi: r ? r.center + BAND_SIGMAS * r.sigma : null };
  });
  const last = nights.length - 1;
  const latestIdx = lns.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).at(-1);
  const latest = latestIdx == null ? null : { day: nights[latestIdx].day, ms: nights[latestIdx].hrvMs as number, ln: lns[latestIdx] as number };
  const recent = lns.slice(Math.max(0, last + 1 - TREND_NIGHTS)).filter((v): v is number => v != null);
  const trendLn = recent.length >= MIN_TREND_NIGHTS ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  const trend = trendLn == null ? null : { ln: trendLn, ms: round(Math.exp(trendLn), 1), valid: recent.length };
  const cv7 = trendLn != null && recent.length >= MIN_TREND_NIGHTS ? round((100 * Math.sqrt(recent.reduce((a, x) => a + (x - trendLn) ** 2, 0) / (recent.length - 1))) / trendLn, 1) : null;
  // The reference for the latest night: the nights before it.
  const r = latestIdx == null ? null : reference(lns.slice(Math.max(0, latestIdx - opts.referenceDays), latestIdx), opts.method);
  const referenceOut = r ? { ...r, ms: round(Math.exp(r.center), 1), lo: r.center - BAND_SIGMAS * r.sigma, hi: r.center + BAND_SIGMAS * r.sigma } : null;
  const z = r && latest ? round((latest.ln - r.center) / r.sigma, 2) : null;
  const validRef = r?.valid ?? lns.filter((v) => v != null).length;
  const value: HrvPanel = { method: opts.method, referenceDays: opts.referenceDays, latest, trend, reference: referenceOut, z, cv7, points };
  const missing = latest == null ? ["hrvMs"] : r == null ? ["reference"] : [];
  const notes = [`Référence : ${opts.referenceDays} nuits avant la nuit évaluée ; bande ±0,5 écart-type ; tendance sur 7 nuits (au moins 4 valides).`];
  if (r == null && latest) notes.push(`${validRef} nuit${validRef > 1 ? "s" : ""} valide${validRef > 1 ? "s" : ""} sur les ${MIN_REFERENCE_NIGHTS} nécessaires.`);
  const out = result<HrvPanel>(ref, "ln(ms)", value, latest ? { hrvMs: { value: latest.ms, unit: "ms", day: latest.day } } : {}, missing, notes);
  // The panel's points are useful even before the reference exists: keep them on the result for the chart.
  return { ...out, value, coverage: { have: validRef, need: MIN_REFERENCE_NIGHTS }, window: nights.length ? { start: nights[0].day, end: nights[last].day } : undefined };
}
