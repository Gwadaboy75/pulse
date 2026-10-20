// The person's calculation choices (Settings › Calculs; docs/formulas.md): read with defaults, saved with validation.
// Changing the Strain model recomputes every day, as a profile change does; the other choices only change what the
// Énergie, HRV and Âge sanguin screens compute at request time.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ACTIVITY_LEVELS, RMR_EQUATIONS } from "@/core/formulas/metabolism";
import { HRV_REFERENCE_METHODS } from "@/core/formulas/hrvReference";
import { PHENO_VARIANTS } from "@/core/formulas/phenoage";
import { STRAIN_METHODS } from "@/core/scoring/strain";
import { type Db, sql } from "./db";
import { calcSettings } from "./db/schema";

export const CalcInput = z.object({
  strainMethod: z.enum(STRAIN_METHODS),
  rmrEquation: z.enum(RMR_EQUATIONS),
  activityLevel: z.enum(ACTIVITY_LEVELS),
  phenoageVariant: z.enum(PHENO_VARIANTS),
  hrvReferenceMethod: z.enum(HRV_REFERENCE_METHODS),
  hrvReferenceDays: z.coerce.number().int().min(28).max(60),
});
export type CalcSettings = z.infer<typeof CalcInput>;

export const CALC_DEFAULTS: CalcSettings = {
  strainMethod: "edwards",
  rmrEquation: "mifflin1990",
  activityLevel: "low_active",
  phenoageVariant: "original",
  hrvReferenceMethod: "ewma",
  hrvReferenceDays: 60,
};

/** The stored choices, or the defaults before any were saved. */
export async function getCalcSettings(db: Db, userId: number): Promise<CalcSettings> {
  const [r] = await db.select().from(calcSettings).where(eq(calcSettings.userId, userId));
  if (!r) return CALC_DEFAULTS;
  const parsed = CalcInput.safeParse({
    strainMethod: r.strainMethod,
    rmrEquation: r.rmrEquation,
    activityLevel: r.activityLevel,
    phenoageVariant: r.phenoageVariant,
    hrvReferenceMethod: r.hrvReferenceMethod,
    hrvReferenceDays: r.hrvReferenceDays,
  });
  // A value an older build wrote that this one no longer knows falls back to the default for that field.
  return parsed.success ? parsed.data : { ...CALC_DEFAULTS, ...Object.fromEntries(Object.entries(parsed.data ?? {}).filter(([, v]) => v !== undefined)) };
}

/**
 * Saves the choices (only the fields given change). When the Strain model changes, every day is marked for
 * recompute, so stage 1 rescoring runs on the next sync. Returns whether Strain must be recomputed.
 */
export async function saveCalcSettings(db: Db, userId: number, input: Partial<CalcSettings>, now = Math.floor(Date.now() / 1000)): Promise<{ recompute: boolean }> {
  const before = await getCalcSettings(db, userId);
  const next: CalcSettings = { ...before, ...input };
  const recompute = next.strainMethod !== before.strainMethod;
  await db.transaction(async (tx) => {
    await tx
      .insert(calcSettings)
      .values({ userId, ...next, updatedAt: now })
      .onConflictDoUpdate({ target: calcSettings.userId, set: { ...next, updatedAt: now } });
    if (recompute) {
      await tx.execute(sql`insert into intraday_dirty (user_id, day)
        select distinct user_id, day from daily_metrics where user_id = ${userId} on conflict do nothing`);
    }
  });
  return { recompute };
}
