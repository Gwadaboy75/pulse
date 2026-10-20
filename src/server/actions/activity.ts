"use server";
// The activity screen's "Effort ressenti" sheet: saves the person's rating of one of their own workouts.
import { revalidatePath } from "next/cache";
import { currentUser, SIGNED_OUT } from "../auth";
import { getDb } from "../db";
import { FeedbackInput, setFeedback } from "../feedback";
import type { ActionResult } from "./journal";

export async function setActivityFeedbackAction(input: unknown): Promise<ActionResult> {
  const me = await currentUser();
  if (!me) return SIGNED_OUT;
  const r = FeedbackInput.safeParse(input);
  if (!r.success) return { ok: false, error: "Effort invalide : de 0 à 10, par demi-point." };
  const saved = await setFeedback(getDb(), me.userId, r.data);
  if (!saved) return { ok: false, error: "Activité introuvable." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
