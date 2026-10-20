// The medical records' writes and the view models they feed: medications and doses, appointments, hand-typed
// results, practitioners, and a document's confirmation (what the model read, as the person edited it).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Config, parseConfig } from "../config";
import type { Db } from "../db";
import { labResults, medicalDocuments, medicationEvents, medications, profile } from "../db/schema";
import { MOCK_EXTRACTION } from "../coach/mock";
import { ctxFor, freshDb, NOW, TZ, USER } from "../testing";
import { getAnalytes, getAppointments, getDocument, getDocuments, getLabTrend, getMedicalHub, getMedications, getPractitioners } from "../queries/medical";
import { confirmExtraction, deleteDocument, deleteMedication, discardExtraction, logDose, saveAppointment, saveLabResult, saveMedication, savePractitioner, setMedicationActive, updateDocument } from "./medical";

const h = vi.hoisted(() => ({ user: null as unknown, cfg: undefined as unknown }));
vi.mock("../auth", async (orig) => ({ ...(await orig<object>()), currentUser: async () => h.user }));
vi.mock("../config", async (orig) => ({ ...(await orig<object>()), getConfig: () => h.cfg as Config }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: Db;
let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-docs-"));
  h.cfg = parseConfig({ DATA_SOURCE: "health-connect", BETTER_AUTH_SECRET: "x".repeat(32), DOCUMENTS_DIR: dir });
  db = await freshDb();
  await db.insert(profile).values({ userId: USER, birthDate: "1990-01-01", sex: "male", timeZone: TZ, updatedAt: NOW });
  h.user = { userId: USER, email: "test@pulse.test", name: "Test", username: "test", image: null };
});
const ctx = () => ctxFor(db, NOW);

describe("signed out", () => {
  it("every write answers SIGNED_OUT and touches nothing", async () => {
    h.user = null;
    expect(await saveMedication({ name: "X", times: [] })).toMatchObject({ ok: false });
    expect(await logDose({ medicationId: 1 })).toMatchObject({ ok: false });
    expect(await saveAppointment({ title: "X", startsAt: "2026-10-03T09:00" })).toMatchObject({ ok: false });
    expect(await saveLabResult({ day: "2026-10-01", label: "X", value: 1 })).toMatchObject({ ok: false });
    expect(await confirmExtraction("00000000-0000-4000-8000-000000000000", MOCK_EXTRACTION)).toMatchObject({ ok: false });
    expect(await db.select().from(medications)).toEqual([]);
  });
});

describe("medications", () => {
  it("adds one with a schedule, shows today's doses, logs a dose, stops it, deletes it with its doses", async () => {
    const r = await saveMedication({ name: "Metformine", dose: "500 mg", form: "comprimé", times: ["08:00", "20:00"], prn: false, startedOn: "2026-09-01", reason: "glycémie", practitioner: "Dr Durand" });
    expect(r).toMatchObject({ ok: true });
    const id = (r as { data: { id: number } }).data.id;
    let [m] = await getMedications(ctx());
    expect(m).toMatchObject({ name: "Metformine", dose: "500 mg", active: true, practitioner: "Dr Durand", schedule: { times: ["08:00", "20:00"] }, today: { due: ["08:00", "20:00"], taken: 0 }, lastTakenAt: null });
    expect((await getPractitioners(ctx())).map((p) => p.name)).toEqual(["Dr Durand"]);

    // The test's "today" is NOW's day, so doses are logged at wall times on it.
    expect(await logDose({ medicationId: id, at: "2026-10-02T20:01" })).toMatchObject({ ok: true });
    expect(await logDose({ medicationId: id, status: "skipped", at: "2026-10-02T08:05" })).toMatchObject({ ok: true });
    [m] = await getMedications(ctx());
    expect(m.today).toMatchObject({ taken: 1, skipped: 1 });
    expect(m.today.events.map((e) => e.status)).toEqual(["skipped", "taken"]); // by time: the 08:05 one first
    expect(m.lastTakenAt).toBeGreaterThan(0);
    expect(await logDose({ medicationId: 999 })).toMatchObject({ ok: false, error: "Not found" });

    // Editing keeps the id and the practitioner is matched case-insensitively.
    expect(await saveMedication({ id, name: "Metformine", dose: "1000 mg", times: ["20:00"], practitioner: "dr durand" })).toMatchObject({ ok: true, data: { id } });
    [m] = await getMedications(ctx());
    expect(m).toMatchObject({ dose: "1000 mg", today: { due: ["20:00"] } });
    expect(await getPractitioners(ctx())).toHaveLength(1);

    expect(await setMedicationActive(id, false)).toMatchObject({ ok: true });
    [m] = await getMedications(ctx());
    expect(m).toMatchObject({ active: false, endedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), today: { due: [] } }); // stopped today (the real today)
    const hub = await getMedicalHub(ctx());
    expect(hub.medications).toEqual([]);
    expect(hub.counts.medications).toBe(0);

    expect(await deleteMedication(id)).toMatchObject({ ok: true });
    expect(await db.select().from(medicationEvents).where(eq(medicationEvents.userId, USER))).toEqual([]);
  });

  it("an as-needed medication is never due; weekdays restrict the due days", async () => {
    await saveMedication({ name: "Paracétamol", prn: true, times: [] });
    await saveMedication({ name: "Vitamine D", times: ["09:00"], weekdays: [1] }); // Monday only; NOW is a Friday
    const meds = await getMedications(ctx());
    expect(meds.map((m) => [m.name, m.today.due])).toEqual([
      ["Paracétamol", []],
      ["Vitamine D", []],
    ]);
  });
});

describe("appointments and results", () => {
  it("an appointment lands in the hub as the next one, by local wall time", async () => {
    const r = await saveAppointment({ title: "Cardiologue", startsAt: "2026-10-10T14:30", durationMin: 30, location: "Clinique", practitioner: "Dr Martin" });
    expect(r).toMatchObject({ ok: true });
    const [a] = await getAppointments(ctx());
    expect(a).toMatchObject({ title: "Cardiologue", practitioner: "Dr Martin", status: "planned", startsAt: Date.parse("2026-10-10T14:30:00+05:30") / 1000, endsAt: Date.parse("2026-10-10T15:00:00+05:30") / 1000 });
    expect((await getMedicalHub(ctx())).nextAppointment?.title).toBe("Cardiologue");
  });

  it("a typed result is keyed by its label, flagged by its range, and trends against earlier ones", async () => {
    expect(await saveLabResult({ day: "2026-08-01", label: "Cholestérol LDL", value: 1.2, unit: "g/L", refHigh: 1.6 })).toMatchObject({ ok: true });
    expect(await saveLabResult({ day: "2026-10-01", label: "Cholestérol LDL", value: 1.8, unit: "g/L", refHigh: 1.6 })).toMatchObject({ ok: true });
    expect(await saveLabResult({ day: "2026-10-01", label: "Sérologie", valueText: "négatif" })).toMatchObject({ ok: true });
    expect(await saveLabResult({ day: "2026-10-01", label: "Vide" })).toMatchObject({ ok: false, error: "Give the result" });
    const analytes = await getAnalytes(ctx());
    expect(analytes.map((a) => [a.analyte, a.count, a.latest.flag, a.delta])).toEqual([
      ["cholesterol_ldl", 2, "high", expect.closeTo(0.6, 6)],
      ["serologie", 1, null, null],
    ]);
    const trend = await getLabTrend(ctx(), "cholesterol_ldl");
    expect(trend?.points.map((p) => p.value)).toEqual([1.2, 1.8]);
    expect(trend?.range).toEqual({ low: null, high: 1.6 });
    expect((await getMedicalHub(ctx())).outOfRange.map((l) => l.analyte)).toEqual(["cholesterol_ldl"]);
    expect(await getLabTrend(ctx(), "nothing")).toBeNull();
  });
});

describe("documents", () => {
  const DOC = "11111111-1111-4111-8111-111111111111";
  async function uploaded() {
    await fs.mkdir(path.join(dir, String(USER)), { recursive: true });
    await fs.writeFile(path.join(dir, String(USER), `${DOC}.pdf`), "%PDF-1.4 mock");
    await db.insert(medicalDocuments).values({ userId: USER, id: DOC, kind: "other", title: `${DOC}.pdf`, filePath: `${USER}/${DOC}.pdf`, mime: "application/pdf", bytes: 13, sha256: "x", status: "review", extraction: MOCK_EXTRACTION, createdAt: NOW, updatedAt: NOW });
  }

  it("confirming what was read writes the results, the medications and the document's details; confirming again replaces them", async () => {
    await uploaded();
    const before = await getDocument(ctx(), DOC);
    expect(before).toMatchObject({ status: "review", labs: [], canExtract: false });
    const r = await confirmExtraction(DOC, MOCK_EXTRACTION);
    expect(r).toEqual({ ok: true, data: { labs: 2, medications: 1, appointments: 0 } });
    const doc = (await getDocument(ctx(), DOC))!;
    expect(doc).toMatchObject({ status: "done", kind: "lab_report", title: "Blood test (mock)", day: "2026-09-30", practitioner: "Dr Mock", labCount: 2, medicationCount: 1 });
    expect(doc.labs.map((l) => [l.analyte, l.value, l.flag, l.labName])).toEqual([
      ["hemoglobin", 14.2, "normal", "Mock Lab"],
      ["ldl_cholesterol", 1.7, "high", "Mock Lab"],
    ]);
    const [med] = await getMedications(ctx());
    expect(med).toMatchObject({ name: "Mockstatin", startedOn: "2026-09-30", endedOn: "2026-12-29", active: true, documentId: DOC, practitioner: "Dr Mock", schedule: { times: ["20:00"] } });
    expect((await getDocuments(ctx()))[0].status).toBe("done");

    // The person corrects a value and confirms again: one set of rows, not two.
    const edited = { ...MOCK_EXTRACTION, labs: [{ ...MOCK_EXTRACTION.labs[1], value: 1.5, flag: null }], medications: [] };
    expect(await confirmExtraction(DOC, edited)).toEqual({ ok: true, data: { labs: 1, medications: 0, appointments: 0 } });
    expect((await getDocument(ctx(), DOC))!.labs.map((l) => [l.analyte, l.value, l.flag])).toEqual([["ldl_cholesterol", 1.5, "normal"]]);
    expect(await getMedications(ctx())).toEqual([]);

    // A bad shape is refused with the field named.
    expect(await confirmExtraction(DOC, { ...MOCK_EXTRACTION, labs: [{ analyte: "Bad Key", label: "x" }] })).toMatchObject({ ok: false, error: expect.stringContaining("labs.0.analyte") });
    expect(await confirmExtraction("not-a-uuid", MOCK_EXTRACTION)).toMatchObject({ ok: false });
  });

  it("discarding keeps the document with nothing read; editing changes its details; deleting unlinks what it wrote and removes the file", async () => {
    await uploaded();
    expect(await discardExtraction(DOC)).toMatchObject({ ok: true });
    expect((await getDocument(ctx(), DOC))!.status).toBe("done");
    expect(await updateDocument({ id: DOC, title: "Ordonnance de mars", kind: "prescription", day: "2026-03-12", practitioner: "Dr Martin", notes: "à renouveler" })).toMatchObject({ ok: true });
    expect((await getDocument(ctx(), DOC))!).toMatchObject({ title: "Ordonnance de mars", kind: "prescription", day: "2026-03-12", practitioner: "Dr Martin", notes: "à renouveler" });

    await confirmExtraction(DOC, MOCK_EXTRACTION);
    expect(await deleteDocument(DOC)).toMatchObject({ ok: true });
    expect(await getDocument(ctx(), DOC)).toBeNull();
    await expect(fs.access(path.join(dir, String(USER), `${DOC}.pdf`))).rejects.toThrow();
    // Its results stay, as the person's own record, no longer linked.
    expect((await db.select({ documentId: labResults.documentId }).from(labResults).where(eq(labResults.userId, USER))).map((r) => r.documentId)).toEqual([null, null]);
    expect(await deleteDocument(DOC)).toMatchObject({ ok: false });
  });

  it("the hub counts documents awaiting review", async () => {
    await uploaded();
    expect((await getMedicalHub(ctx())).pendingReview).toBe(1);
    expect((await getMedicalHub(ctx())).recentDocuments[0]).toMatchObject({ id: DOC, status: "review" });
  });
});

describe("practitioners", () => {
  it("are added, edited and listed by name", async () => {
    const r = await savePractitioner({ name: "Dr Zed", specialty: "Cardiologie" });
    expect(r).toMatchObject({ ok: true });
    await savePractitioner({ name: "Dr Abel" });
    expect((await getPractitioners(ctx())).map((p) => p.name)).toEqual(["Dr Abel", "Dr Zed"]);
    expect(await savePractitioner({ id: (r as { data: { id: number } }).data.id, name: "Dr Zed", specialty: "Cardiologue", phone: "01" })).toMatchObject({ ok: true });
    expect((await getPractitioners(ctx())).find((p) => p.name === "Dr Zed")).toMatchObject({ specialty: "Cardiologue", phone: "01" });
  });
});
