// The medical records' view models (/medical and its screens). Every read filters on ctx.userId.
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { coachReady } from "../coach/store";
import { appointments, labResults, medicalDocuments, medicationEvents, medications, practitioners } from "../db/schema";
import { egfrCkdEpi2021, homaIr, nonHdl, tyg } from "@/core/formulas/clinical";
import { crpTenfoldYears, PHENO_MARKERS, PHENO_UNITS, phenoAge, type PhenoInputs } from "@/core/formulas/phenoage";
import { FORMULAS } from "@/core/formulas/registry";
import { type Marker, pickMarkers } from "../medical/analytes";
import { addDays, fractionalYears, localDay, localMidnight } from "../time";
import type { QueryCtx } from "./common";
import { none, ok, todayOf } from "./common";
import type { AnalyteVM, AppointmentVM, BloodAgeVM, ClinicalVM, DocumentDetailVM, DocumentVM, LabResultVM, LabTrendVM, MedicalHubVM, MedicationVM, PractitionerVM } from "./types";

export const documentUrl = (id: string) => `/documents/${encodeURIComponent(id)}`;

const labVM = (r: typeof labResults.$inferSelect): LabResultVM => ({
  id: r.id,
  day: r.day,
  analyte: r.analyte,
  label: r.label,
  value: r.value,
  valueText: r.valueText,
  unit: r.unit,
  refLow: r.refLow,
  refHigh: r.refHigh,
  refText: r.refText,
  flag: r.flag,
  labName: r.labName,
  documentId: r.documentId,
});

async function practitionerNames(ctx: QueryCtx): Promise<Map<number, string>> {
  const rows = await ctx.db.select({ id: practitioners.id, name: practitioners.name }).from(practitioners).where(eq(practitioners.userId, ctx.userId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function getPractitioners(ctx: QueryCtx): Promise<PractitionerVM[]> {
  const rows = await ctx.db.select().from(practitioners).where(eq(practitioners.userId, ctx.userId)).orderBy(asc(practitioners.name));
  return rows.map((r) => ({ id: r.id, name: r.name, specialty: r.specialty, phone: r.phone, address: r.address, notes: r.notes }));
}

// ── Labs ─────────────────────────────────────────────────────────────────────

/** Every result, newest first (bounded: the person's own file, a few hundred rows at most). */
export async function getLabResults(ctx: QueryCtx): Promise<LabResultVM[]> {
  const rows = await ctx.db
    .select()
    .from(labResults)
    .where(eq(labResults.userId, ctx.userId))
    .orderBy(desc(labResults.day), asc(labResults.label), desc(labResults.id));
  return rows.map(labVM);
}

/** One row per analyte: its latest result, how many it has, and the move since the result before. */
export async function getAnalytes(ctx: QueryCtx): Promise<AnalyteVM[]> {
  const all = await getLabResults(ctx);
  const by = new Map<string, LabResultVM[]>();
  for (const r of all) by.set(r.analyte, [...(by.get(r.analyte) ?? []), r]);
  return [...by.entries()]
    .map(([analyte, rows]) => {
      const [latest, previous] = rows;
      const delta = latest.value !== null && previous?.value != null ? latest.value - previous.value : null;
      return { analyte, label: latest.label, unit: latest.unit, latest, count: rows.length, delta };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** One analyte's results oldest first, and the range to draw (the latest result's bounds). */
export async function getLabTrend(ctx: QueryCtx, analyte: string): Promise<LabTrendVM | null> {
  const rows = await ctx.db
    .select()
    .from(labResults)
    .where(and(eq(labResults.userId, ctx.userId), eq(labResults.analyte, analyte)))
    .orderBy(asc(labResults.day), asc(labResults.id));
  if (!rows.length) return null;
  const points = rows.map(labVM);
  const latest = points.at(-1)!;
  const range = latest.refLow !== null || latest.refHigh !== null ? { low: latest.refLow, high: latest.refHigh } : null;
  return { analyte, label: latest.label, unit: latest.unit, points, range };
}

// ── Blood age and clinical calculators ───────────────────────────────────────

/** A used marker older than this makes the result provisional. */
export const MARKER_MAX_AGE_DAYS = 180;

/** Âge sanguin: PhenoAge from the latest result of each of its nine markers, converted to the model's units. */
export async function getBloodAge(ctx: QueryCtx): Promise<BloodAgeVM> {
  const today = todayOf(ctx);
  const all = await getLabResults(ctx);
  const picks = pickMarkers(all);
  const inputs: PhenoInputs = {};
  const markers: BloodAgeVM["markers"] = [];
  const notes: string[] = [];
  for (const m of PHENO_MARKERS) {
    const p = picks.get(m);
    const converted = p?.normalized.input ?? null;
    if (converted) inputs[m] = converted;
    const note = p?.normalized.note ?? null;
    if (note && !converted) notes.push(note);
    markers.push({ marker: m, unit: PHENO_UNITS[m], result: p?.result ?? null, converted, note });
  }
  const age = fractionalYears(ctx.profile.birthDate, today);
  const r = phenoAge(inputs, age, ctx.calc.phenoageVariant);
  const used = markers.filter((m) => m.converted);
  const drawDay = used.length ? used.map((m) => m.result!.day).sort().at(-1)! : null;
  const stale = used.some((m) => addDays(m.result!.day, MARKER_MAX_AGE_DAYS) < today);
  return {
    today,
    age: Math.floor(age),
    variant: ctx.calc.phenoageVariant,
    result: r.value ? ok(r.value, stale) : none("no_data"),
    markers,
    drawDay,
    stale,
    notes: [...r.notes, ...notes],
    crpTenfoldYears: crpTenfoldYears(ctx.calc.phenoageVariant),
  };
}

/** The clinical calculators whose inputs are on file: eGFR, non-HDL, TyG, HOMA-IR. */
export async function getClinical(ctx: QueryCtx): Promise<ClinicalVM> {
  const all = await getLabResults(ctx);
  const picks = pickMarkers(all);
  const input = (m: Marker) => picks.get(m)?.normalized.input ?? null;
  const row = (m: Marker) => {
    const p = picks.get(m);
    return p ? [{ label: p.result.label, day: p.result.day, printed: `${p.result.value ?? p.result.valueText ?? "—"}${p.result.unit ? ` ${p.result.unit}` : ""}` }] : [];
  };
  // eGFR wants creatinine in mg/dL: back from the model's µmol/L.
  const creat = input("creatinine");
  const creatMgDl = creat ? { ...creat, value: Math.round((creat.value / 88.4) * 1000) / 1000, unit: "mg/dL" } : null;
  const age = fractionalYears(ctx.profile.birthDate, todayOf(ctx));
  const glucoseMmol = input("glucose");
  const glucoseMgDl = glucoseMmol ? { ...glucoseMmol, value: Math.round(glucoseMmol.value * 18.018 * 100) / 100, unit: "mg/dL" } : null;
  const candidates: ClinicalVM = [
    { id: "clinical.egfrCkdEpi2021", name: FORMULAS["clinical.egfrCkdEpi2021"].name, result: egfrCkdEpi2021(creatMgDl, age, ctx.profile.sex), inputs: row("creatinine") },
    { id: "clinical.nonHdl", name: FORMULAS["clinical.nonHdl"].name, result: nonHdl(input("total_cholesterol"), input("hdl")), inputs: [...row("total_cholesterol"), ...row("hdl")] },
    { id: "clinical.tyg", name: FORMULAS["clinical.tyg"].name, result: tyg(input("triglycerides"), glucoseMgDl), inputs: [...row("triglycerides"), ...row("glucose")] },
    { id: "clinical.homaIr", name: FORMULAS["clinical.homaIr"].name, result: homaIr(glucoseMmol, input("insulin")), inputs: [...row("glucose"), ...row("insulin")] },
  ];
  return candidates.filter((c) => c.result.value !== null);
}

// ── Medications ──────────────────────────────────────────────────────────────

/** Doses due on `day` by the schedule: every time, on the listed weekdays (1 = Monday) or every day; none when as needed. */
export function dueTimes(schedule: MedicationVM["schedule"], day: string): string[] {
  if (!schedule || schedule.prn) return [];
  if (schedule.weekdays?.length) {
    const weekday = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (!schedule.weekdays.includes(weekday)) return [];
  }
  return [...schedule.times].sort();
}

export async function getMedications(ctx: QueryCtx, { activeOnly = false } = {}): Promise<MedicationVM[]> {
  const today = todayOf(ctx);
  const names = await practitionerNames(ctx);
  const rows = await ctx.db
    .select()
    .from(medications)
    .where(and(eq(medications.userId, ctx.userId), ...(activeOnly ? [eq(medications.active, true)] : [])))
    .orderBy(desc(medications.active), asc(medications.name));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const e = medicationEvents;
  const [todayEvents, lastTaken] = await Promise.all([
    ctx.db
      .select({ id: e.id, medicationId: e.medicationId, ts: e.ts, status: e.status })
      .from(e)
      .where(and(eq(e.userId, ctx.userId), eq(e.day, today), inArray(e.medicationId, ids)))
      .orderBy(asc(e.ts)),
    ctx.db
      .select({ medicationId: e.medicationId, ts: sql<number>`max(${e.ts})`.mapWith(Number) })
      .from(e)
      .where(and(eq(e.userId, ctx.userId), eq(e.status, "taken"), inArray(e.medicationId, ids)))
      .groupBy(e.medicationId),
  ]);
  const last = new Map(lastTaken.map((r) => [r.medicationId, r.ts]));
  return rows.map((r) => {
    const events = todayEvents.filter((x) => x.medicationId === r.id).map(({ id, ts, status }) => ({ id, ts, status }));
    return {
      id: r.id,
      name: r.name,
      dose: r.dose,
      form: r.form,
      route: r.route,
      schedule: r.schedule,
      startedOn: r.startedOn,
      endedOn: r.endedOn,
      active: r.active,
      reason: r.reason,
      notes: r.notes,
      documentId: r.documentId,
      practitioner: r.practitionerId != null ? (names.get(r.practitionerId) ?? null) : null,
      today: { due: r.active ? dueTimes(r.schedule, today) : [], taken: events.filter((x) => x.status === "taken").length, skipped: events.filter((x) => x.status === "skipped").length, events },
      lastTakenAt: last.get(r.id) ?? null,
    };
  });
}

// ── Documents ────────────────────────────────────────────────────────────────

async function documentVMs(ctx: QueryCtx, rows: (typeof medicalDocuments.$inferSelect)[]): Promise<DocumentVM[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const names = await practitionerNames(ctx);
  const [labs, meds] = await Promise.all([
    ctx.db
      .select({ documentId: labResults.documentId, n: count() })
      .from(labResults)
      .where(and(eq(labResults.userId, ctx.userId), inArray(labResults.documentId, ids)))
      .groupBy(labResults.documentId),
    ctx.db
      .select({ documentId: medications.documentId, n: count() })
      .from(medications)
      .where(and(eq(medications.userId, ctx.userId), inArray(medications.documentId, ids)))
      .groupBy(medications.documentId),
  ]);
  const labCount = new Map(labs.map((r) => [r.documentId, r.n]));
  const medCount = new Map(meds.map((r) => [r.documentId, r.n]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    day: r.day,
    status: r.status,
    error: r.error,
    mime: r.mime,
    bytes: r.bytes,
    createdAt: r.createdAt,
    url: documentUrl(r.id),
    practitioner: r.practitionerId != null ? (names.get(r.practitionerId) ?? null) : null,
    notes: r.notes,
    labCount: labCount.get(r.id) ?? 0,
    medicationCount: medCount.get(r.id) ?? 0,
  }));
}

/** Every document, newest (by its own date, then upload) first. */
export async function getDocuments(ctx: QueryCtx): Promise<DocumentVM[]> {
  const rows = await ctx.db
    .select()
    .from(medicalDocuments)
    .where(eq(medicalDocuments.userId, ctx.userId))
    .orderBy(desc(sql`coalesce(${medicalDocuments.day}, '9999-12-31')`), desc(medicalDocuments.createdAt));
  return documentVMs(ctx, rows);
}

export async function getDocument(ctx: QueryCtx, id: string): Promise<DocumentDetailVM | null> {
  const [row] = await ctx.db.select().from(medicalDocuments).where(and(eq(medicalDocuments.userId, ctx.userId), eq(medicalDocuments.id, id)));
  if (!row) return null;
  const [vm] = await documentVMs(ctx, [row]);
  const [labs, meds, canExtract] = await Promise.all([
    ctx.db.select().from(labResults).where(and(eq(labResults.userId, ctx.userId), eq(labResults.documentId, id))).orderBy(asc(labResults.label)),
    ctx.db
      .select({ id: medications.id, name: medications.name, dose: medications.dose, active: medications.active })
      .from(medications)
      .where(and(eq(medications.userId, ctx.userId), eq(medications.documentId, id)))
      .orderBy(asc(medications.name)),
    coachReady(ctx.db, ctx.userId),
  ]);
  return { ...vm, extraction: row.extraction, extractedText: row.extractedText, labs: labs.map(labVM), medications: meds, canExtract };
}

// ── Appointments ─────────────────────────────────────────────────────────────

export async function getAppointments(ctx: QueryCtx): Promise<AppointmentVM[]> {
  const names = await practitionerNames(ctx);
  const rows = await ctx.db.select().from(appointments).where(eq(appointments.userId, ctx.userId)).orderBy(desc(appointments.startsAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    location: r.location,
    notes: r.notes,
    status: r.status,
    practitioner: r.practitionerId != null ? (names.get(r.practitionerId) ?? null) : null,
    documentId: r.documentId,
  }));
}

// ── The hub ──────────────────────────────────────────────────────────────────

export async function getMedicalHub(ctx: QueryCtx): Promise<MedicalHubVM> {
  const today = todayOf(ctx);
  const dayStart = localMidnight(today, ctx.timeZone);
  const [meds, analytes, docs, nextAppt, [pending], [apptCount]] = await Promise.all([
    getMedications(ctx, { activeOnly: true }),
    getAnalytes(ctx),
    getDocuments(ctx),
    ctx.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.userId, ctx.userId), eq(appointments.status, "planned"), gte(appointments.startsAt, dayStart)))
      .orderBy(asc(appointments.startsAt))
      .limit(1),
    ctx.db
      .select({ n: count() })
      .from(medicalDocuments)
      .where(and(eq(medicalDocuments.userId, ctx.userId), inArray(medicalDocuments.status, ["review", "failed"]))),
    ctx.db.select({ n: count() }).from(appointments).where(eq(appointments.userId, ctx.userId)),
  ]);
  const names = nextAppt.length ? await practitionerNames(ctx) : new Map<number, string>();
  const a = nextAppt[0];
  return {
    today,
    timeZone: ctx.timeZone,
    medications: meds,
    nextAppointment: a
      ? { id: a.id, title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, location: a.location, notes: a.notes, status: a.status, practitioner: a.practitionerId != null ? (names.get(a.practitionerId) ?? null) : null, documentId: a.documentId }
      : null,
    outOfRange: analytes.map((x) => x.latest).filter((l) => l.flag !== null && l.flag !== "normal"),
    recentDocuments: docs.slice(0, 5),
    pendingReview: pending.n,
    counts: { documents: docs.length, analytes: analytes.length, medications: meds.length, appointments: apptCount.n },
  };
}

/** Local day of an instant, for events (exported for the actions). */
export const dayOfTs = (ts: number, tz: string) => localDay(ts, tz);
