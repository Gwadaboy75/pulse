"use server";
// Settings › Calculs: the person's calculation choices. A Strain-model change marks every day dirty and wakes the
// worker, as a profile change does.
import { revalidatePath } from "next/cache";
import { currentUser, SIGNED_OUT } from "../auth";
import { CalcInput, saveCalcSettings } from "../calc";
import { getDb } from "../db";
import { requestSync } from "../worker";
import type { ActionResult } from "./journal";

export async function saveCalcAction(input: unknown): Promise<ActionResult<{ recompute: boolean }>> {
  const me = await currentUser();
  if (!me) return SIGNED_OUT;
  const r = CalcInput.partial().safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Réglage invalide." };
  const { recompute } = await saveCalcSettings(getDb(), me.userId, r.data);
  if (recompute) requestSync({ userId: me.userId, force: true });
  revalidatePath("/", "layout");
  return { ok: true, data: { recompute } };
}
