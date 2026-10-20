"use server";
// Medical records writes: medications and the doses taken, appointments, practitioners, hand-typed lab results,
// documents (edit, delete, confirm or discard what the model read, read again). Every action checks the session
// first and writes only the caller's rows. Results are returned, not thrown, so forms can show them.
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser, SIGNED_OUT } from "../auth";
import { getDb } from "../db";
import { appointments, labResults, medicalDocuments, medicationEvents, medications, practitioners } from "../db/schema";
import { extractDocument } from "../medical/extract";
import { analyteKey, DOCUMENT_KINDS, Extraction, flagOf, LAB_FLAGS } from "../medical/extraction";
import { removeDocumentFile } from "../medical/storage";
import { type DoseInput, logDoseFor, type MedicationInput, practitionerIdFor, saveMedicationFor } from "../medical/writes";
import { userTimeZone } from "../profile";
import { fromWall, localDay } from "../time";
import type { ActionResult } from "./journal";

export type { DoseInput, MedicationInput };

const now = () => Math.floor(Date.now() / 1000);
const refresh = () => revalidatePath("/medical", "layout");
const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();

async function me() {
  const user = await currentUser();
  if (!user) return null;
  const db = getDb();
  const tz = (await userTimeZone(db, user.userId)) ?? "UTC";
  return { db, userId: user.userId, tz, today: localDay(now(), tz) };
}

// ── Medications ──────────────────────────────────────────────────────────────

export async function saveMedication(input: MedicationInput): Promise<ActionResult<{ id: number }>> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const r = await saveMedicationFor(u, input);
  if (r.ok) refresh();
  return r;
}

/** Stops (today) or resumes a medication. */
export async function setMedicationActive(id: number, active: boolean): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  await u.db
    .update(medications)
    .set({ active, endedOn: active ? null : u.today, updatedAt: now() })
    .where(and(eq(medications.userId, u.userId), eq(medications.id, id)));
  refresh();
  return { ok: true, data: undefined };
}

export async function deleteMedication(id: number): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  await u.db.delete(medications).where(and(eq(medications.userId, u.userId), eq(medications.id, id)));
  refresh();
  return { ok: true, data: undefined };
}

/** Logs a dose taken (or skipped), now or at a local wall time. */
export async function logDose(input: DoseInput): Promise<ActionResult<{ id: number }>> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const r = await logDoseFor(u, input);
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: { id: r.data.id } };
}

export async function deleteDose(id: number): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  await u.db.delete(medicationEvents).where(and(eq(medicationEvents.userId, u.userId), eq(medicationEvents.id, id)));
  refresh();
  return { ok: true, data: undefined };
}

// ── Appointments ─────────────────────────────────────────────────────────────

const AppointmentInput = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(1, "Give the appointment a title").max(120),
  /** Local wall time `YYYY-MM-DDTHH:MM`. */
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time"),
  durationMin: z.number().int().min(5).max(720).nullable().optional(),
  location: opt(160),
  notes: opt(1000),
  practitioner: opt(120),
  status: z.enum(["planned", "done", "cancelled"]).default("planned"),
});
export type AppointmentInput = z.input<typeof AppointmentInput>;

export async function saveAppointment(input: AppointmentInput): Promise<ActionResult<{ id: number }>> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const r = AppointmentInput.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const v = r.data;
  const startsAt = fromWall(v.startsAt, u.tz);
  const values = {
    title: v.title,
    startsAt,
    endsAt: v.durationMin ? startsAt + v.durationMin * 60 : null,
    location: v.location ?? null,
    notes: v.notes ?? null,
    status: v.status,
    practitionerId: await practitionerIdFor(u.db, u.userId, v.practitioner),
  };
  let id = v.id;
  if (id) {
    const updated = await u.db.update(appointments).set(values).where(and(eq(appointments.userId, u.userId), eq(appointments.id, id))).returning({ id: appointments.id });
    if (!updated.length) return { ok: false, error: "Not found" };
  } else {
    [{ id }] = await u.db.insert(appointments).values({ userId: u.userId, ...values, createdAt: now() }).returning({ id: appointments.id });
  }
  refresh();
  return { ok: true, data: { id } };
}

export async function setAppointmentStatus(id: number, status: "planned" | "done" | "cancelled"): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  await u.db.update(appointments).set({ status }).where(and(eq(appointments.userId, u.userId), eq(appointments.id, id)));
  refresh();
  return { ok: true, data: undefined };
}

export async function deleteAppointment(id: number): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  await u.db.delete(appointments).where(and(eq(appointments.userId, u.userId), eq(appointments.id, id)));
  refresh();
  return { ok: true, data: undefined };
}

// ── Lab results typed by hand ────────────────────────────────────────────────

const LabInput = z.object({
  day: z.iso.date(),
  label: z.string().trim().min(1, "Name the test").max(120),
  analyte: z.string().trim().max(64).optional(),
  value: z.number().finite().nullable().optional(),
  valueText: opt(64),
  unit: opt(32),
  refLow: z.number().finite().nullable().optional(),
  refHigh: z.number().finite().nullable().optional(),
  flag: z.enum(LAB_FLAGS).nullable().optional(),
  labName: opt(120),
});
export type LabInput = z.input<typeof LabInput>;

export async function saveLabResult(input: LabInput): Promise<ActionResult<{ id: number }>> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const r = LabInput.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const v = r.data;
  if (v.value == null && !v.valueText) return { ok: false, error: "Give the result" };
  const row = {
    userId: u.userId,
    day: v.day,
    analyte: v.analyte?.trim() ? analyteKey(v.analyte) : analyteKey(v.label),
    label: v.label,
    value: v.value ?? null,
    valueText: v.valueText ?? null,
    unit: v.unit ?? null,
    refLow: v.refLow ?? null,
    refHigh: v.refHigh ?? null,
    refText: null,
    flag: flagOf({ value: v.value ?? null, refLow: v.refLow ?? null, refHigh: v.refHigh ?? null, flag: v.flag ?? null }),
    labName: v.labName ?? null,
    createdAt: now(),
  };
  const [added] = await u.db.insert(labResults).values(row).returning({ id: labResults.id });
  refresh();
  return { ok: true, data: { id: added.id } };
}

export async function deleteLabResult(id: number): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  await u.db.delete(labResults).where(and(eq(labResults.userId, u.userId), eq(labResults.id, id)));
  refresh();
  return { ok: true, data: undefined };
}

// ── Practitioners ────────────────────────────────────────────────────────────

const PractitionerInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Give a name").max(120),
  specialty: opt(80),
  phone: opt(40),
  address: opt(200),
  notes: opt(1000),
});
export type PractitionerInput = z.input<typeof PractitionerInput>;

export async function savePractitioner(input: PractitionerInput): Promise<ActionResult<{ id: number }>> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const r = PractitionerInput.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const { id: given, ...v } = r.data;
  const values = { name: v.name, specialty: v.specialty ?? null, phone: v.phone ?? null, address: v.address ?? null, notes: v.notes ?? null };
  let id = given;
  if (id) {
    const updated = await u.db.update(practitioners).set(values).where(and(eq(practitioners.userId, u.userId), eq(practitioners.id, id))).returning({ id: practitioners.id });
    if (!updated.length) return { ok: false, error: "Not found" };
  } else {
    [{ id }] = await u.db.insert(practitioners).values({ userId: u.userId, ...values, createdAt: now() }).returning({ id: practitioners.id });
  }
  refresh();
  return { ok: true, data: { id } };
}

export async function deletePractitioner(id: number): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  await u.db.delete(practitioners).where(and(eq(practitioners.userId, u.userId), eq(practitioners.id, id)));
  refresh();
  return { ok: true, data: undefined };
}

// ── Documents ────────────────────────────────────────────────────────────────

const DocumentInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Give the document a title").max(120),
  kind: z.enum(DOCUMENT_KINDS),
  day: z.iso.date().nullable().optional(),
  notes: opt(2000),
  practitioner: opt(120),
});
export type DocumentInput = z.input<typeof DocumentInput>;

export async function updateDocument(input: DocumentInput): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const r = DocumentInput.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const v = r.data;
  const updated = await u.db
    .update(medicalDocuments)
    .set({ title: v.title, kind: v.kind, day: v.day ?? null, notes: v.notes ?? null, practitionerId: await practitionerIdFor(u.db, u.userId, v.practitioner), updatedAt: now() })
    .where(and(eq(medicalDocuments.userId, u.userId), eq(medicalDocuments.id, v.id)))
    .returning({ id: medicalDocuments.id });
  if (!updated.length) return { ok: false, error: "Not found" };
  refresh();
  return { ok: true, data: undefined };
}

/** Deletes the document and its file. Results and medications read out of it stay (they are the person's record now), unlinked. */
export async function deleteDocument(id: string): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const where = and(eq(medicalDocuments.userId, u.userId), eq(medicalDocuments.id, id));
  const [doc] = await u.db.select({ filePath: medicalDocuments.filePath }).from(medicalDocuments).where(where);
  if (!doc) return { ok: false, error: "Not found" };
  await u.db.transaction(async (tx) => {
    await tx.update(labResults).set({ documentId: null }).where(and(eq(labResults.userId, u.userId), eq(labResults.documentId, id)));
    await tx.update(medications).set({ documentId: null }).where(and(eq(medications.userId, u.userId), eq(medications.documentId, id)));
    await tx.update(appointments).set({ documentId: null }).where(and(eq(appointments.userId, u.userId), eq(appointments.documentId, id)));
    await tx.delete(medicalDocuments).where(where);
  });
  await removeDocumentFile(doc.filePath).catch(() => {});
  refresh();
  return { ok: true, data: undefined };
}

/**
 * Writes what the person confirmed (the model's reading, as they edited it): the document's title, kind and date;
 * one lab result per row; one medication per entry (starting on the document's date, ending after its duration);
 * one appointment per entry. Confirming again replaces what this document wrote before.
 */
export async function confirmExtraction(id: string, extraction: unknown): Promise<ActionResult<{ labs: number; medications: number; appointments: number }>> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Not found" };
  const r = Extraction.safeParse(extraction);
  if (!r.success) return { ok: false, error: `${r.error.issues[0].path.join(".")}: ${r.error.issues[0].message}` };
  const x = r.data;
  const where = and(eq(medicalDocuments.userId, u.userId), eq(medicalDocuments.id, id));
  const [doc] = await u.db.select({ day: medicalDocuments.day }).from(medicalDocuments).where(where);
  if (!doc) return { ok: false, error: "Not found" };
  const day = x.date ?? doc.day ?? u.today;
  const practitionerId = await practitionerIdFor(u.db, u.userId, x.practitioner);
  const t = now();
  await u.db.transaction(async (tx) => {
    await tx.delete(labResults).where(and(eq(labResults.userId, u.userId), eq(labResults.documentId, id)));
    await tx.delete(appointments).where(and(eq(appointments.userId, u.userId), eq(appointments.documentId, id)));
    // Medications from an earlier confirmation of this document go, with their logged doses (the FK cascades).
    await tx.delete(medications).where(and(eq(medications.userId, u.userId), eq(medications.documentId, id)));
    if (x.labs.length)
      await tx.insert(labResults).values(
        x.labs.map((l) => ({
          userId: u.userId,
          documentId: id,
          day,
          analyte: l.analyte,
          label: l.label,
          value: l.value,
          valueText: l.valueText,
          unit: l.unit,
          refLow: l.refLow,
          refHigh: l.refHigh,
          refText: l.refText,
          flag: flagOf(l),
          labName: x.labName,
          createdAt: t,
        })),
      );
    if (x.medications.length)
      await tx.insert(medications).values(
        x.medications.map((m) => {
          const endedOn = m.durationDays ? localDay(fromWall(`${day}T12:00`, u.tz) + m.durationDays * 86_400, u.tz) : null;
          return {
            userId: u.userId,
            name: m.name,
            dose: m.dose,
            form: m.form,
            route: m.route,
            schedule: { times: [...new Set(m.times)].sort(), ...(m.prn && { prn: true }) },
            startedOn: day,
            endedOn,
            active: !endedOn || endedOn >= u.today,
            reason: m.reason,
            practitionerId,
            documentId: id,
            createdAt: t,
            updatedAt: t,
          };
        }),
      );
    const appts = x.appointments.filter((a) => a.date);
    if (appts.length)
      await tx.insert(appointments).values(
        appts.map((a) => ({
          userId: u.userId,
          practitionerId,
          title: a.title,
          startsAt: fromWall(`${a.date}T${a.time ?? "09:00"}`, u.tz),
          location: a.location,
          status: "planned" as const,
          documentId: id,
          createdAt: t,
        })),
      );
    await tx
      .update(medicalDocuments)
      .set({ title: x.title, kind: x.kind, day, practitionerId, extraction: x, status: "done", error: null, updatedAt: t })
      .where(where);
  });
  refresh();
  return { ok: true, data: { labs: x.labs.length, medications: x.medications.length, appointments: x.appointments.filter((a) => a.date).length } };
}

/** Keeps the document as it is, with nothing read out of it. */
export async function discardExtraction(id: string): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  await u.db
    .update(medicalDocuments)
    .set({ status: "done", error: null, updatedAt: now() })
    .where(and(eq(medicalDocuments.userId, u.userId), eq(medicalDocuments.id, id)));
  refresh();
  return { ok: true, data: undefined };
}

/** Reads the document again with the coach's model (after a failure, or once a model is set up). */
export async function extractAgain(id: string): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const [doc] = await u.db.select({ id: medicalDocuments.id }).from(medicalDocuments).where(and(eq(medicalDocuments.userId, u.userId), eq(medicalDocuments.id, id)));
  if (!doc) return { ok: false, error: "Not found" };
  await extractDocument(u.db, u.userId, id);
  refresh();
  return { ok: true, data: undefined };
}

/** Bulk: the documents whose ids are given, deleted (the Documents list's selection). */
export async function deleteDocuments(ids: string[]): Promise<ActionResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const valid = ids.filter((i) => z.string().uuid().safeParse(i).success).slice(0, 100);
  if (!valid.length) return { ok: true, data: undefined };
  const rows = await u.db.select({ id: medicalDocuments.id, filePath: medicalDocuments.filePath }).from(medicalDocuments).where(and(eq(medicalDocuments.userId, u.userId), inArray(medicalDocuments.id, valid)));
  for (const d of rows) await deleteDocument(d.id);
  return { ok: true, data: undefined };
}
