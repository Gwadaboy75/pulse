// The medication writes shared by the Server Actions (actions/medical.ts) and the coach's tools
// (coach/medicalTools.ts): one place validates and writes, for the user both callers already identified.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { medicationEvents, medications, practitioners } from "../db/schema";
import { fromWall, localDay } from "../time";

export type Who = { db: Db; userId: number; tz: string; today: string; now?: () => number };
export type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

const nowS = () => Math.floor(Date.now() / 1000);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();

/** Finds the practitioner by name (case-insensitively) or adds them. Null for an empty name. */
export async function practitionerIdFor(db: Db, userId: number, name: string | null | undefined, now = nowS): Promise<number | null> {
  const n = name?.trim();
  if (!n) return null;
  const rows = await db.select({ id: practitioners.id, name: practitioners.name }).from(practitioners).where(eq(practitioners.userId, userId));
  const hit = rows.find((r) => r.name.toLowerCase() === n.toLowerCase());
  if (hit) return hit.id;
  const [added] = await db.insert(practitioners).values({ userId, name: n.slice(0, 120), createdAt: now() }).returning({ id: practitioners.id });
  return added.id;
}

export const MedicationInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Give the medication a name").max(120),
  dose: opt(64),
  form: opt(40),
  route: opt(40),
  times: z.array(clock).max(8).default([]),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  prn: z.boolean().default(false),
  startedOn: z.iso.date().nullable().optional(),
  endedOn: z.iso.date().nullable().optional(),
  reason: opt(160),
  notes: opt(1000),
  practitioner: opt(120),
});
export type MedicationInput = z.input<typeof MedicationInput>;

/** Adds a medication, or updates it when `id` is given. */
export async function saveMedicationFor(u: Who, input: MedicationInput): Promise<Outcome<{ id: number }>> {
  const r = MedicationInput.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const v = r.data;
  if (v.startedOn && v.endedOn && v.endedOn < v.startedOn) return { ok: false, error: "The end is before the start" };
  const now = u.now ?? nowS;
  const values = {
    name: v.name,
    dose: v.dose ?? null,
    form: v.form ?? null,
    route: v.route ?? null,
    schedule: { times: [...new Set(v.times)].sort(), ...(v.weekdays?.length && { weekdays: [...new Set(v.weekdays)].sort() }), ...(v.prn && { prn: true }) },
    startedOn: v.startedOn ?? null,
    endedOn: v.endedOn ?? null,
    active: !v.endedOn || v.endedOn >= u.today,
    reason: v.reason ?? null,
    notes: v.notes ?? null,
    practitionerId: await practitionerIdFor(u.db, u.userId, v.practitioner, now),
    updatedAt: now(),
  };
  let id = v.id;
  if (id) {
    const updated = await u.db.update(medications).set(values).where(and(eq(medications.userId, u.userId), eq(medications.id, id))).returning({ id: medications.id });
    if (!updated.length) return { ok: false, error: "Not found" };
  } else {
    [{ id }] = await u.db.insert(medications).values({ userId: u.userId, ...values, createdAt: now() }).returning({ id: medications.id });
  }
  return { ok: true, data: { id } };
}

export const DoseInput = z.object({
  medicationId: z.number().int().positive(),
  status: z.enum(["taken", "skipped"]).default("taken"),
  /** Local wall time `YYYY-MM-DDTHH:MM`; omitted means now. */
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  note: opt(200),
});
export type DoseInput = z.input<typeof DoseInput>;

/** Logs a dose taken (or skipped) of one of the user's medications, now or at a local wall time. */
export async function logDoseFor(u: Who, input: DoseInput): Promise<Outcome<{ id: number; medication: string; ts: number }>> {
  const r = DoseInput.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const v = r.data;
  const now = u.now ?? nowS;
  const [m] = await u.db.select({ id: medications.id, name: medications.name }).from(medications).where(and(eq(medications.userId, u.userId), eq(medications.id, v.medicationId)));
  if (!m) return { ok: false, error: "Not found" };
  const ts = v.at ? fromWall(v.at, u.tz) : now();
  if (ts > now() + 60) return { ok: false, error: "Can’t log the future" };
  if (ts < now() - 366 * 86_400) return { ok: false, error: "Can’t log more than a year back" };
  const [row] = await u.db
    .insert(medicationEvents)
    .values({ userId: u.userId, medicationId: v.medicationId, ts, day: localDay(ts, u.tz), status: v.status, note: v.note ?? null })
    .returning({ id: medicationEvents.id });
  return { ok: true, data: { id: row.id, medication: m.name, ts } };
}
