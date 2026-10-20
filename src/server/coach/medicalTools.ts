// The coach's medical tools, bound to the signed-in user's QueryCtx by closure, as tools.ts does. The read tools
// digest the medical screens (never a document's bytes or file path); the write tools add a medication or log a
// dose, each after the user's tap (coachApproval). Nothing here diagnoses: the instructions (texts.ts) say how the
// coach may talk about what it reads.
import { tool } from "ai";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { medicalDocuments } from "../db/schema";
import { logDoseFor, saveMedicationFor } from "../medical/writes";
import type { QueryCtx } from "../queries/common";
import { todayOf } from "../queries/common";
import { getAnalytes, getAppointments, getBloodAge, getDocuments, getLabResults, getMedications } from "../queries/medical";
import { addDays } from "../time";
import { defaultTexts, type Texts } from "./texts";

const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** What a medical write tool returns: done, or why not. */
export type MedicalWriteOutput = { done: true; detail: string } | { done: false; error: string };

export function medicalTools(ctx: QueryCtx, t: Texts = defaultTexts) {
  const who = () => ({ db: ctx.db, userId: ctx.userId, tz: ctx.timeZone, today: todayOf(ctx), now: () => ctx.now });
  return {
    get_medications: tool({
      description: t("tool.get_medications"),
      inputSchema: z.object({ includePast: z.boolean().default(false).describe(t("tool.get_medications.includePast")) }),
      execute: async ({ includePast }) => {
        const meds = await getMedications(ctx, { activeOnly: !includePast });
        return {
          today: todayOf(ctx),
          medications: meds.map((m) => ({
            id: m.id,
            name: m.name,
            dose: m.dose,
            form: m.form,
            route: m.route,
            schedule: m.schedule?.prn ? "as needed" : m.schedule?.times.length ? m.schedule.times.join(", ") : "no schedule",
            weekdays: m.schedule?.weekdays ?? null,
            startedOn: m.startedOn,
            endedOn: m.endedOn,
            active: m.active,
            reason: m.reason,
            prescribedBy: m.practitioner,
            today: { due: m.today.due, taken: m.today.taken, skipped: m.today.skipped },
            lastTakenAt: m.lastTakenAt === null ? null : new Date(m.lastTakenAt * 1000).toISOString(),
          })),
        };
      },
    }),
    get_lab_results: tool({
      description: t("tool.get_lab_results"),
      inputSchema: z.object({
        analyte: z.string().max(64).optional().describe(t("tool.get_lab_results.analyte")),
        days: z.number().int().min(1).max(3650).default(365).describe(t("tool.get_lab_results.days")),
      }),
      execute: async ({ analyte, days }) => {
        const since = addDays(todayOf(ctx), -(days - 1));
        const all = (await getLabResults(ctx)).filter((r) => r.day >= since && (!analyte || r.analyte === analyte || r.label.toLowerCase().includes(analyte.toLowerCase())));
        const analytes = await getAnalytes(ctx);
        const results = all.slice(0, 120).map((r) => ({
          day: r.day,
          analyte: r.analyte,
          label: r.label,
          value: r.value === null ? null : round(r.value, 3),
          valueText: r.valueText,
          unit: r.unit,
          referenceRange: r.refLow !== null || r.refHigh !== null ? { low: r.refLow, high: r.refHigh } : (r.refText ?? null),
          flag: r.flag,
          lab: r.labName,
        }));
        return {
          since,
          today: todayOf(ctx),
          total: all.length,
          truncated: all.length > 120,
          results,
          // The analytes on file, so the model can ask for one by its key.
          analytes: analytes.map((a) => ({ analyte: a.analyte, label: a.label, unit: a.unit, latestDay: a.latest.day, latestValue: a.latest.value, latestFlag: a.latest.flag, count: a.count, changeSincePrevious: a.delta === null ? null : round(a.delta, 3) })),
        };
      },
    }),
    get_documents: tool({
      description: t("tool.get_documents"),
      inputSchema: z.object({ kind: z.enum(["lab_report", "prescription", "imaging", "letter", "other"]).optional().describe(t("tool.get_documents.kind")) }),
      execute: async ({ kind }) => {
        const docs = (await getDocuments(ctx)).filter((d) => !kind || d.kind === kind);
        return { total: docs.length, documents: docs.slice(0, 50).map((d) => ({ id: d.id, kind: d.kind, title: d.title, day: d.day, status: d.status, practitioner: d.practitioner, labResults: d.labCount, medications: d.medicationCount })) };
      },
    }),
    search_documents: tool({
      description: t("tool.search_documents"),
      inputSchema: z.object({ query: z.string().min(2).max(80).describe(t("tool.search_documents.query")) }),
      execute: async ({ query }) => {
        const d = medicalDocuments;
        const pattern = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        const rows = await ctx.db
          .select({ id: d.id, kind: d.kind, title: d.title, day: d.day, status: d.status, extraction: d.extraction, notes: d.notes })
          .from(d)
          .where(and(eq(d.userId, ctx.userId), inArray(d.status, ["done", "review"]), or(ilike(d.title, pattern), ilike(d.notes, pattern), ilike(d.extractedText, pattern), sql`${d.extraction}::text ilike ${pattern}`)))
          .orderBy(desc(sql`coalesce(${d.day}, '9999-12-31')`))
          .limit(20);
        return {
          query,
          matches: rows.map((r) => {
            const x = (r.extraction ?? {}) as { summary?: unknown };
            return { id: r.id, kind: r.kind, title: r.title, day: r.day, status: r.status, summary: typeof x.summary === "string" ? x.summary.slice(0, 600) : null, notes: r.notes };
          }),
        };
      },
    }),
    get_blood_age: tool({
      description: t("tool.get_blood_age"),
      inputSchema: z.object({}),
      execute: async () => {
        const vm = await getBloodAge(ctx);
        const r = vm.result.value;
        return {
          today: vm.today,
          chronologicalAge: vm.age,
          variant: vm.variant,
          phenoAge: r ? r.phenoAge : null,
          simpleDelta: r ? r.delta : null,
          provisional: vm.result.provisional,
          drawDay: vm.drawDay,
          markers: vm.markers.map((m) => ({
            marker: m.marker,
            modelUnit: m.unit,
            used: m.converted ? { value: round(m.converted.value, 4), unit: m.converted.unit, day: m.converted.day, printed: m.converted.from ?? null, rule: m.converted.rule ?? null } : null,
            missingWhy: m.converted ? null : (m.note ?? "no result on file"),
          })),
          notes: vm.notes,
        };
      },
    }),
    get_appointments: tool({
      description: t("tool.get_appointments"),
      inputSchema: z.object({ includePast: z.boolean().default(false).describe(t("tool.get_appointments.includePast")) }),
      execute: async ({ includePast }) => {
        const all = await getAppointments(ctx);
        const list = all.filter((a) => includePast || (a.status === "planned" && a.startsAt >= ctx.now - 3600)).sort((a, b) => a.startsAt - b.startsAt);
        return {
          now: new Date(ctx.now * 1000).toISOString(),
          timeZone: ctx.timeZone,
          appointments: list.slice(0, 50).map((a) => ({ id: a.id, title: a.title, startsAt: new Date(a.startsAt * 1000).toISOString(), status: a.status, with: a.practitioner, location: a.location, notes: a.notes })),
        };
      },
    }),
    log_medication_taken: tool({
      description: t("tool.log_medication_taken"),
      inputSchema: z.object({
        medicationId: z.number().int().positive().describe(t("tool.log_medication_taken.medicationId")),
        status: z.enum(["taken", "skipped"]).default("taken").describe(t("tool.log_medication_taken.status")),
        at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().describe(t("tool.log_medication_taken.at")),
      }),
      execute: async ({ medicationId, status, at }): Promise<MedicalWriteOutput> => {
        const r = await logDoseFor(who(), { medicationId, status, at });
        return r.ok ? { done: true, detail: `${r.data.medication}: ${status}` } : { done: false, error: r.error };
      },
    }),
    add_medication: tool({
      description: t("tool.add_medication"),
      inputSchema: z.object({
        name: z.string().min(1).max(120).describe(t("tool.add_medication.name")),
        dose: z.string().max(64).optional().describe(t("tool.add_medication.dose")),
        times: z.array(clock).max(8).default([]).describe(t("tool.add_medication.times")),
        prn: z.boolean().default(false).describe(t("tool.add_medication.prn")),
        startedOn: z.iso.date().optional().describe(t("tool.add_medication.startedOn")),
        endedOn: z.iso.date().optional().describe(t("tool.add_medication.endedOn")),
        reason: z.string().max(160).optional().describe(t("tool.add_medication.reason")),
      }),
      execute: async (input): Promise<MedicalWriteOutput> => {
        const r = await saveMedicationFor(who(), { ...input, startedOn: input.startedOn ?? todayOf(ctx) });
        return r.ok ? { done: true, detail: `${input.name}${input.dose ? ` ${input.dose}` : ""}` } : { done: false, error: r.error };
      },
    }),
  };
}
