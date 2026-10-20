// Perceived training load: session-RPE (Foster 2001) per session, and over a 7-day window the weekly load, Foster's
// monotony (mean / sample SD of the daily loads, rest days as 0) and strain (weekly load × monotony). Separate from
// the heart-rate TRIMP that Strain uses; the units are not comparable and are never added.
import { FORMULAS } from "./registry";
import { type FormulaResult, result, round } from "./types";

/** Borg's CR-10 anchors, for the input sheet. */
export const CR10: readonly [number, string][] = [
  [0, "Repos"],
  [1, "Très facile"],
  [2, "Facile"],
  [3, "Modéré"],
  [4, "Assez dur"],
  [5, "Dur"],
  [6, ""],
  [7, "Très dur"],
  [8, ""],
  [9, ""],
  [10, "Maximal"],
];

export const sessionRpe = (minutes: number, rpe: number): number => minutes * rpe;

export type DailyRpeLoad = {
  day: string;
  /** Sum of the day's rated sessions, 0 on a day without any (a measured rest day). */
  load: number;
  rated: number;
  /** Sessions that day without a rating: the day's load is then a lower bound. */
  unrated: number;
};

export type WeeklyLoad = { weeklyLoad: number; monotony: number | null; strain: number | null; rated: number; unrated: number };

/** Over exactly the 7 days given (oldest first). Monotony is null when the loads don't vary (σ = 0). */
export function weeklyLoad(days: DailyRpeLoad[]): FormulaResult<WeeklyLoad> {
  const ref = FORMULAS["load.monotonyFoster1998"];
  const n = days.length;
  const rated = days.reduce((s, d) => s + d.rated, 0);
  const unrated = days.reduce((s, d) => s + d.unrated, 0);
  const notes: string[] = [];
  if (unrated) notes.push(`${unrated} séance${unrated > 1 ? "s" : ""} sans effort ressenti : la charge est un minimum.`);
  if (n !== 7) return result<WeeklyLoad>(ref, "session-RPE", null, {}, ["dailyLoad"], ["Il faut exactement 7 jours."]);
  if (rated === 0) return result<WeeklyLoad>(ref, "session-RPE", null, {}, ["dailyLoad"], notes);
  const loads = days.map((d) => d.load);
  const sum = loads.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sd = Math.sqrt(loads.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  const monotony = sd > 0 ? mean / sd : null;
  if (monotony == null) notes.push("Charges identiques tous les jours : la monotonie n’est pas définie.");
  const out: WeeklyLoad = { weeklyLoad: round(sum), monotony: monotony == null ? null : round(monotony, 2), strain: monotony == null ? null : round(sum * monotony), rated, unrated };
  return { ...result<WeeklyLoad>(ref, "session-RPE", out, { dailyLoad: { value: n, unit: "jours" } }, [], notes), window: { start: days[0].day, end: days[n - 1].day }, coverage: { have: rated, need: rated + unrated } };
}
