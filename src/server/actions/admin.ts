"use server";
// The admin panel's actions (/admin). Each checks that the caller is an admin of a Google instance itself: the page
// hiding its buttons is not the check.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createInvite, deleteAccount, isAdmin, isOwnerEmail, resetPassword, revokeInvite, setRole, setSignupMode, signOutEverywhere, SIGNUP_MODES, type SignupMode } from "../admin";
import { currentUser, SIGNED_OUT } from "../auth";
import { COACH_MODES, setCoachAllowed, setCoachMode, type CoachMode } from "../coach/store";
import { DEFAULTS, maxFor, saveText } from "../coach/texts";
import { getConfig } from "../config";
import { getDb } from "../db";
import { user } from "../db/schema";
import type { ActionResult } from "./journal";

const NOT_ADMIN = { ok: false as const, error: "Only an admin can do this." };
const UNKNOWN = { ok: false as const, error: "Unknown account." };
const DONE = { ok: true as const, data: undefined };
const Id = z.number().int().positive();

/** The signed-in admin's id, or the result to return instead. */
async function admin(): Promise<number | ActionResult<never>> {
  const me = await currentUser();
  if (!me) return SIGNED_OUT;
  if (getConfig().demo || !(await isAdmin(getDb(), me.userId))) return NOT_ADMIN;
  return me.userId;
}

/** Whether `id` is an account the panel may change: it exists and isn't an ADMIN_EMAILS owner (the environment's). */
async function changeable(id: number): Promise<boolean> {
  if (!Id.safeParse(id).success) return false;
  const [u] = await getDb().select({ email: user.email }).from(user).where(eq(user.id, id));
  return !!u && !isOwnerEmail(u.email);
}

export async function setSignupModeAction(mode: SignupMode): Promise<ActionResult> {
  const me = await admin();
  if (typeof me !== "number") return me;
  if (!SIGNUP_MODES.includes(mode)) return { ok: false, error: "Unknown sign-up mode." };
  await setSignupMode(getDb(), mode);
  revalidatePath("/admin");
  return DONE;
}

/** Coach access for the server: off, everyone, or the accounts picked below. */
export async function setCoachModeAction(mode: CoachMode): Promise<ActionResult> {
  const me = await admin();
  if (typeof me !== "number") return me;
  if (!COACH_MODES.includes(mode)) return { ok: false, error: "Unknown coach setting." };
  await setCoachMode(getDb(), mode);
  revalidatePath("/", "layout"); // the round P button follows access on every screen
  return DONE;
}

/** Picks an account for the coach (Coach = chosen accounts). Owners always have it, so they aren't changed here. */
export async function setCoachAllowedAction(userId: number, allowed: boolean): Promise<ActionResult> {
  const me = await admin();
  if (typeof me !== "number") return me;
  if (!(await changeable(userId))) return UNKNOWN;
  await setCoachAllowed(getDb(), userId, allowed === true);
  revalidatePath("/admin");
  return DONE;
}

/**
 * Saves a new version of one piece of the coach's wording (instructions, a tool or a parameter description). Restore
 * and reset save the old or default text as a new version, so the history only ever grows.
 */
export async function saveCoachTextAction(key: string, body: string): Promise<ActionResult> {
  const me = await admin();
  if (typeof me !== "number") return me;
  if (!Object.hasOwn(DEFAULTS, key)) return { ok: false, error: "Unknown text." };
  const text = String(body).replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, error: "Write something, or reset to the default." };
  if (text.length > maxFor(key)) return { ok: false, error: `Keep it under ${maxFor(key)} characters.` };
  await saveText(getDb(), key, text, me);
  revalidatePath("/admin/coach");
  return DONE;
}

/** A new invite link's token, shown once; the page builds `/signup?invite=<token>` from it. */
export async function createInviteAction(label: string): Promise<ActionResult<string>> {
  const me = await admin();
  if (typeof me !== "number") return me;
  const token = await createInvite(getDb(), me, String(label).trim().slice(0, 60) || null);
  revalidatePath("/admin");
  return { ok: true, data: token };
}

export async function revokeInviteAction(id: number): Promise<ActionResult> {
  const me = await admin();
  if (typeof me !== "number") return me;
  if (!Id.safeParse(id).success) return { ok: false, error: "Unknown invite." };
  await revokeInvite(getDb(), id);
  revalidatePath("/admin");
  return DONE;
}

export async function setRoleAction(userId: number, role: "user" | "admin"): Promise<ActionResult> {
  const me = await admin();
  if (typeof me !== "number") return me;
  if ((role !== "user" && role !== "admin") || !(await changeable(userId))) return UNKNOWN;
  await setRole(getDb(), userId, role);
  revalidatePath("/admin");
  return DONE;
}

/** Signs another account out on every device. Your own sessions are managed from Settings. */
export async function signOutEverywhereAction(userId: number): Promise<ActionResult<number>> {
  const me = await admin();
  if (typeof me !== "number") return me;
  if (userId === me) return { ok: false, error: "Sign yourself out from Settings." };
  if (!(await changeable(userId))) return UNKNOWN;
  const n = await signOutEverywhere(getDb(), userId);
  revalidatePath("/admin/people");
  return { ok: true, data: n };
}

/**
 * Sets a temporary password for another account and signs it out everywhere; returns the password, shown once.
 * Owners (ADMIN_EMAILS) only: whoever sets a password can sign in as that person and see their health data, the
 * same power as the server's reset-password script, which only the owner can run.
 */
export async function resetPasswordAction(userId: number): Promise<ActionResult<string>> {
  const me = await admin();
  if (typeof me !== "number") return me;
  const caller = await currentUser();
  if (!caller || !isOwnerEmail(caller.email)) return { ok: false, error: "Only an owner (ADMIN_EMAILS) can reset passwords." };
  if (userId === me) return { ok: false, error: "Change your own password from Settings." };
  if (!(await changeable(userId))) return UNKNOWN;
  const temp = await resetPassword(getDb(), userId);
  revalidatePath("/admin/people");
  return { ok: true, data: temp };
}

/** Deletes another account and all its data. Your own goes from Settings; an admin is made a member first. */
export async function deleteAccountAction(userId: number): Promise<ActionResult> {
  const me = await admin();
  if (typeof me !== "number") return me;
  if (userId === me) return { ok: false, error: "Delete your own account from Settings." };
  if (!(await changeable(userId))) return UNKNOWN;
  if ((await deleteAccount(getDb(), userId)) === "admin") return { ok: false, error: "Remove admin from this account first." };
  revalidatePath("/admin");
  return DONE;
}
