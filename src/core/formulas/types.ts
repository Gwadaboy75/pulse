// The formula engine's shared shapes (docs/formulas.md). Every calculation in src/core/formulas returns a
// FormulaResult: the value with the method's id and version, each input with its unit (and the printed value it was
// converted from), what was missing, and notes a screen shows as they are. Nothing here reads a clock or a database.

export type Sex = "male" | "female";

export type Source = { label: string; url?: string };

/** One line of the registry (registry.ts): what a method is, where it comes from, what it needs. */
export type FormulaRef = {
  id: FormulaId;
  /** Shown name, e.g. "Mifflin-St Jeor (1990)". */
  name: string;
  /** Bumped when the implementation changes a number; stored beside every result. */
  version: string;
  sources: Source[];
  /** The population and conditions the method was derived for. */
  domain: string;
  inputs: { key: string; unit: string }[];
  notes?: string[];
};

/** An input as the calculation used it; `from` keeps the value as printed when a conversion was applied. */
export type FormulaInput = {
  value: number;
  unit: string;
  /** The day the input is from, when it has one (a lab result, a weigh-in). */
  day?: string;
  from?: { value: number; unit: string };
  /** A rule applied to get the value (for example "loq_half": below the limit of quantification, taken as half of it). */
  rule?: string;
};

export type FormulaResult<T = number> = {
  id: FormulaId;
  version: string;
  value: T | null;
  unit: string;
  window?: { start: string; end: string };
  inputs: Record<string, FormulaInput>;
  /** Input keys the calculation could not get; a non-empty list means `value` is null. */
  missing: string[];
  coverage?: { have: number; need: number };
  /** Caveats about this result (out of the method's domain, a rule applied), in the words the screen shows. */
  notes: string[];
};

export type FormulaId =
  | "rmr.mifflin1990"
  | "rmr.harrisBenedict1919"
  | "rmr.rozaShizgal1984"
  | "rmr.cunningham1980"
  | "rmr.cunningham1991"
  | "rmr.owen1987"
  | "rmr.schofield1985"
  | "rmr.henryOxford2005"
  | "rmr.tenHaaf2014"
  | "rmr.tenHaaf2014Ffm"
  | "tdee.pal"
  | "tdee.eer2023"
  | "energy.met"
  | "age.metabolic"
  | "bioage.phenoage2018"
  | "clinical.egfrCkdEpi2021"
  | "clinical.nonHdl"
  | "clinical.tyg"
  | "clinical.homaIr"
  | "load.sessionRpe"
  | "load.monotonyFoster1998"
  | "hrv.reference"
  | "strain.edwards1993"
  | "strain.banister1991"
  | "strain.cardioLoadCore"
  | "baseline.ewmaWinsor"
  | "recovery.pulse"
  | "trainingLoad.ctlAtl"
  | "acwr.rolling7_28"
  | "sri.phillips2017"
  | "sleepNeed.p75"
  | "pulseAge.gompertz";

/** A result; `T` is the value's type (number unless given), so a null value never narrows it. */
export const result = <T = number>(ref: Pick<FormulaRef, "id" | "version">, unit: string, value: NoInfer<T> | null, inputs: Record<string, FormulaInput>, missing: string[] = [], notes: string[] = []): FormulaResult<T> => ({
  id: ref.id,
  version: ref.version,
  value: missing.length ? null : value,
  unit,
  inputs,
  missing,
  notes,
});

export const round = (v: number, dp = 0): number => Math.round(v * 10 ** dp) / 10 ** dp;
