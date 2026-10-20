// Formules et calculs `/more/formulas`: the registry grouped by screen, with the method the person chose marked.
import type { FormulaId, FormulaRef } from "@/core/formulas/types";
import { FORMULAS } from "@/core/formulas/registry";
import type { QueryCtx } from "./common";

export type FormulaRowVM = FormulaRef & { inUse: boolean; href: string | null };
export type FormulasVM = { groups: { key: "scores" | "strain" | "energy" | "blood" | "load" | "hrv"; rows: FormulaRowVM[] }[]; count: number };

const GROUPS: { key: FormulasVM["groups"][number]["key"]; ids: FormulaId[]; href: string | null }[] = [
  { key: "scores", ids: ["recovery.pulse", "baseline.ewmaWinsor", "sleepNeed.p75", "sri.phillips2017", "trainingLoad.ctlAtl", "acwr.rolling7_28", "pulseAge.gompertz"], href: "/more/how-it-works" },
  { key: "strain", ids: ["strain.edwards1993", "strain.banister1991", "strain.cardioLoadCore"], href: "/strain" },
  { key: "energy", ids: ["rmr.mifflin1990", "rmr.harrisBenedict1919", "rmr.rozaShizgal1984", "rmr.cunningham1980", "rmr.cunningham1991", "rmr.owen1987", "rmr.schofield1985", "rmr.henryOxford2005", "rmr.tenHaaf2014", "rmr.tenHaaf2014Ffm", "tdee.pal", "tdee.eer2023", "energy.met", "age.metabolic"], href: "/health/energy" },
  { key: "blood", ids: ["bioage.phenoage2018", "clinical.egfrCkdEpi2021", "clinical.nonHdl", "clinical.tyg", "clinical.homaIr"], href: "/medical/bloodage" },
  { key: "load", ids: ["load.sessionRpe", "load.monotonyFoster1998"], href: "/strain" },
  { key: "hrv", ids: ["hrv.reference"], href: "/health/hrv" },
];

/** Which registry entries the person's choices put in use; the fixed ones are always in use. */
export function inUse(ctx: Pick<QueryCtx, "calc">, id: FormulaId): boolean {
  const c = ctx.calc;
  if (id.startsWith("strain.")) return id === `strain.${c.strainMethod === "edwards" ? "edwards1993" : c.strainMethod === "banister" ? "banister1991" : "cardioLoadCore"}`;
  if (id.startsWith("rmr.")) return id === `rmr.${c.rmrEquation}`;
  return true;
}

export function getFormulas(ctx: Pick<QueryCtx, "calc">): FormulasVM {
  const groups = GROUPS.map((g) => ({ key: g.key, rows: g.ids.map((id) => ({ ...FORMULAS[id], inUse: inUse(ctx, id), href: g.href })) }));
  return { groups, count: groups.reduce((n, g) => n + g.rows.length, 0) };
}
