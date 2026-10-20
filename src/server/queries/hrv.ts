// HRV `/health/hrv` (docs/formulas.md): the nightly HRV series with the person's chosen reference (Settings › Calculs),
// computed at request time. Recovery keeps its own baseline; this panel only shows other references beside it.
import { and, eq, gte, lte } from "drizzle-orm";
import { hrvPanel, type HrvNight } from "@/core/formulas/hrvReference";
import { dailyMetrics } from "../db/schema";
import { addDays } from "../time";
import { none, ok, type QueryCtx, todayOf } from "./common";
import type { HrvVM } from "./types";

/** Days of history the panel reads: the longest reference window plus the 7-night trend, with a margin for gaps. */
export const HRV_HISTORY_DAYS = 90;

export async function getHrvPanel(ctx: QueryCtx): Promise<HrvVM> {
  const today = todayOf(ctx);
  const from = addDays(today, -(HRV_HISTORY_DAYS - 1));
  const rows = await ctx.db
    .select({ day: dailyMetrics.day, hrvMs: dailyMetrics.hrvMs })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.userId, ctx.userId), gte(dailyMetrics.day, from), lte(dailyMetrics.day, today)));
  const byDay = new Map(rows.map((r) => [r.day, r.hrvMs]));
  const nights: HrvNight[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) nights.push({ day: d, hrvMs: byDay.get(d) ?? null });
  const r = hrvPanel(nights, { method: ctx.calc.hrvReferenceMethod, referenceDays: ctx.calc.hrvReferenceDays });
  const panel = r.value;
  const complete = panel && panel.latest && panel.reference;
  const z = panel?.z ?? null;
  return {
    day: today,
    panel: complete ? ok(panel) : none(panel?.latest ? "calibrating" : "no_data"),
    position: z == null ? null : z > 0.5 ? "above" : z < -0.5 ? "below" : "in",
    points: panel?.points ?? [],
    notes: r.notes,
    coverage: r.coverage ?? null,
  };
}
