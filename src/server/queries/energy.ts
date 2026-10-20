// Énergie `/health/energy` (docs/formulas.md): the resting rate by the person's chosen equation, every equation side
// by side, the total expenditure two ways, and the wearable's own calories kept apart. Computed at request time from
// the latest weigh-in, the profile and Settings › Calculs; nothing here feeds a score.
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { ACTIVITY_LEVELS, eer2023, fatFreeMass, metabolicAge, rmr, RMR_EQUATIONS, type RmrInputs, tdeePal } from "@/core/formulas/metabolism";
import { FORMULAS } from "@/core/formulas/registry";
import { dailyMetrics } from "../db/schema";
import { addDays, fractionalYears } from "../time";
import { finite, none, ok, type QueryCtx, todayOf } from "./common";
import type { EnergyVM } from "./types";

/** Body-fat readings older than this don't feed the fat-free-mass equations (BIA drifts; a stale share misleads). */
export const BODY_FAT_MAX_AGE_DAYS = 90;

async function latest(ctx: QueryCtx, col: typeof dailyMetrics.weightKg | typeof dailyMetrics.bodyFatPct, today: string): Promise<{ value: number; day: string } | null> {
  const [r] = await ctx.db
    .select({ value: col, day: dailyMetrics.day })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.userId, ctx.userId), isNotNull(col), lte(dailyMetrics.day, today)))
    .orderBy(desc(dailyMetrics.day))
    .limit(1);
  return r && finite(r.value) ? { value: r.value, day: r.day } : null;
}

export async function getEnergy(ctx: QueryCtx): Promise<EnergyVM> {
  const today = todayOf(ctx);
  const [weight, bodyFat, calories] = await Promise.all([
    latest(ctx, dailyMetrics.weightKg, today),
    latest(ctx, dailyMetrics.bodyFatPct, today),
    ctx.db
      .select({ day: dailyMetrics.day, calories: dailyMetrics.calories })
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, ctx.userId), gte(dailyMetrics.day, addDays(today, -6)), lte(dailyMetrics.day, today))),
  ]);
  const ffmStale = !!bodyFat && addDays(bodyFat.day, BODY_FAT_MAX_AGE_DAYS) < today;
  const ffmKg = weight && bodyFat && !ffmStale ? Math.round(fatFreeMass(weight.value, bodyFat.value) * 10) / 10 : null;
  const age = fractionalYears(ctx.profile.birthDate, today);
  const inputs: RmrInputs = { weightKg: weight?.value ?? null, heightCm: ctx.profile.heightCm, ageYears: age, sex: ctx.profile.sex, ffmKg };
  const chosen = rmr(ctx.calc.rmrEquation, inputs);
  const comparison = RMR_EQUATIONS.map((eq) => {
    const r = rmr(eq, inputs);
    return { equation: eq, name: FORMULAS[`rmr.${eq}`].name, value: r.value, notes: r.notes, missing: r.missing, inUse: eq === ctx.calc.rmrEquation };
  });
  const level = ctx.calc.activityLevel;
  const pal = chosen.value != null ? tdeePal(chosen.value, level) : null;
  const eer = eer2023(ctx.profile.sex, level, { weightKg: inputs.weightKg, heightCm: inputs.heightCm, ageYears: age });
  const mAge = chosen.value != null && weight && ctx.profile.heightCm != null ? metabolicAge(chosen.value, { weightKg: weight.value, heightCm: ctx.profile.heightCm, sex: ctx.profile.sex }) : null;
  const cal7 = calories.map((c) => c.calories).filter(finite);
  return {
    day: today,
    inputs: { weight, bodyFat, ffmKg, ffmStale, heightCm: ctx.profile.heightCm, age: Math.floor(age), sex: ctx.profile.sex },
    equation: ctx.calc.rmrEquation,
    equationName: FORMULAS[`rmr.${ctx.calc.rmrEquation}`].name,
    rmr: chosen.value != null ? ok(chosen) : none("no_data"),
    comparison,
    tdee: { level, pal: pal ? ok(pal) : none("no_data"), eer: eer.value != null ? ok(eer) : none("no_data") },
    metabolicAge: mAge ? ok(mAge) : none("no_data"),
    wearable: { today: calories.find((c) => c.day === today)?.calories ?? null, mean7: cal7.length ? Math.round(cal7.reduce((a, b) => a + b, 0) / cal7.length) : null },
    levels: ACTIVITY_LEVELS,
  };
}
