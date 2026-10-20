// What the person says about a workout afterwards (activity_feedback): the perceived effort behind the session-RPE
// load (src/core/formulas/sessionLoad.ts) and a note. Read per exercise id; written from the activity screen.
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { type DailyRpeLoad, sessionRpe, weeklyLoad } from "@/core/formulas/sessionLoad";
import type { FormulaResult } from "@/core/formulas/types";
import type { WeeklyLoad } from "@/core/formulas/sessionLoad";
import type { Db } from "./db";
import { activityFeedback, exercises } from "./db/schema";
import { addDays } from "./time";

export const FeedbackInput = z.object({
  exerciseId: z.string().min(1).max(128),
  /** Borg CR-10, in half points; null clears the rating. */
  rpe: z.coerce.number().min(0).max(10).multipleOf(0.5).nullable(),
  note: z.string().trim().max(200).nullable().optional(),
});
export type FeedbackInput = z.infer<typeof FeedbackInput>;

export type Feedback = { rpe: number | null; note: string | null };

/** The feedback rows for these exercise ids, keyed by id. */
export async function getFeedback(db: Db, userId: number, ids: string[]): Promise<Map<string, Feedback>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: activityFeedback.exerciseId, rpe: activityFeedback.rpe, note: activityFeedback.note })
    .from(activityFeedback)
    .where(and(eq(activityFeedback.userId, userId), inArray(activityFeedback.exerciseId, ids)));
  return new Map(rows.map((r) => [r.id, { rpe: r.rpe, note: r.note }]));
}

/** Saves the feedback for one of the person's own exercises; false when the exercise isn't theirs. */
export async function setFeedback(db: Db, userId: number, input: FeedbackInput, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const [e] = await db.select({ id: exercises.id }).from(exercises).where(and(eq(exercises.userId, userId), eq(exercises.id, input.exerciseId)));
  if (!e) return false;
  const row = { rpe: input.rpe, note: input.note?.trim() || null, updatedAt: now };
  if (row.rpe == null && row.note == null) {
    await db.delete(activityFeedback).where(and(eq(activityFeedback.userId, userId), eq(activityFeedback.exerciseId, input.exerciseId)));
    return true;
  }
  await db
    .insert(activityFeedback)
    .values({ userId, exerciseId: input.exerciseId, ...row })
    .onConflictDoUpdate({ target: [activityFeedback.userId, activityFeedback.exerciseId], set: row });
  return true;
}

export type LoadExercise = { id: string; day: string; startTs: number; endTs: number };

/**
 * The 7 days ending on `day` as daily session-RPE loads: each rated session adds minutes × RPE to its day; a day with
 * no session is a rest day (0); unrated sessions are counted so the result can say the load is a lower bound.
 */
export function perceivedLoad(day: string, exs: LoadExercise[], feedback: Map<string, Feedback>): FormulaResult<WeeklyLoad> {
  const days: DailyRpeLoad[] = Array.from({ length: 7 }, (_, i) => ({ day: addDays(day, i - 6), load: 0, rated: 0, unrated: 0 }));
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const e of exs) {
    const d = byDay.get(e.day);
    if (!d) continue;
    const rpe = feedback.get(e.id)?.rpe ?? null;
    if (rpe == null) d.unrated++;
    else {
      d.rated++;
      d.load += sessionRpe((e.endTs - e.startTs) / 60, rpe);
    }
  }
  return weeklyLoad(days);
}
