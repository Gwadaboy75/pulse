// The coach's medical tools: each reads the signed-in user's file alone, the writes go through the shared
// medication writes, and the approval map covers every write tool.
import { describe, expect, it } from "vitest";
import { MEDICAL_WRITE_TOOLS } from "@/lib/medical";
import { appointments, labResults, medicalDocuments, medications, profile } from "../db/schema";
import { addUser, ctxFor, freshDb, NOW, TZ, USER } from "../testing";
import { coachApproval } from "./logTools";
import { medicalTools } from "./medicalTools";
import { TOOL_DOCS } from "./texts";
import { coachTools } from "./tools";

const opts = { toolCallId: "t", messages: [] } as never;
/** A tool's output as its object (the execute type also admits a stream, which these tools never return). */
const run = async <T,>(p: T): Promise<Exclude<Awaited<T>, AsyncIterable<unknown>>> => (await p) as never;

describe("medicalTools", () => {
  it("read tools digest the user's file; another user's rows never show", async () => {
    const db = await freshDb();
    await db.insert(profile).values({ userId: USER, birthDate: "1990-01-01", sex: "male", timeZone: TZ, updatedAt: NOW });
    const other = await addUser(db);
    for (const userId of [USER, other]) {
      const tag = userId === USER ? "mine" : "INTRUDER";
      await db.insert(medications).values({ userId, name: `${tag} pill`, dose: "10 mg", schedule: { times: ["08:00"] }, active: true, startedOn: "2026-09-01", createdAt: NOW, updatedAt: NOW });
      await db.insert(labResults).values([
        { userId, day: "2026-09-01", analyte: "ldl_cholesterol", label: `${tag} LDL`, value: 1.2, unit: "g/L", refHigh: 1.6, flag: "normal", createdAt: NOW },
        { userId, day: "2026-10-01", analyte: "ldl_cholesterol", label: `${tag} LDL`, value: 1.9, unit: "g/L", refHigh: 1.6, flag: "high", createdAt: NOW },
      ]);
      await db.insert(medicalDocuments).values({ userId, id: userId === USER ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "lab_report", title: `${tag} blood test`, filePath: "x", mime: "application/pdf", bytes: 1, sha256: "x", day: "2026-10-01", status: "done", extraction: { summary: `${tag} summary mentions ferritin` }, createdAt: NOW, updatedAt: NOW });
      await db.insert(appointments).values({ userId, title: `${tag} visit`, startsAt: NOW + 86400, status: "planned", createdAt: NOW });
    }
    const t = medicalTools(ctxFor(db));
    const meds = await run(t.get_medications.execute!({ includePast: false }, opts));
    expect(meds.medications.map((m) => [m.name, m.schedule, m.today.due])).toEqual([["mine pill", "08:00", ["08:00"]]]);
    const labs = await run(t.get_lab_results.execute!({ analyte: "ldl_cholesterol", days: 365 }, opts));
    expect(labs.results.map((r) => [r.day, r.value, r.flag, r.referenceRange])).toEqual([
      ["2026-10-01", 1.9, "high", { low: null, high: 1.6 }],
      ["2026-09-01", 1.2, "normal", { low: null, high: 1.6 }],
    ]);
    expect(labs.analytes).toEqual([expect.objectContaining({ analyte: "ldl_cholesterol", latestValue: 1.9, changeSincePrevious: 0.7, count: 2 })]);
    expect((await run(t.get_lab_results.execute!({ analyte: "LDL", days: 10 }, opts))).results).toHaveLength(1);
    const docs = await run(t.get_documents.execute!({}, opts));
    expect(docs.documents.map((d) => d.title)).toEqual(["mine blood test"]);
    const found = await run(t.search_documents.execute!({ query: "ferritin" }, opts));
    expect(found.matches.map((m) => [m.title, m.summary])).toEqual([["mine blood test", "mine summary mentions ferritin"]]);
    expect((await run(t.search_documents.execute!({ query: "INTRUDER" }, opts))).matches).toEqual([]);
    const appts = await run(t.get_appointments.execute!({ includePast: false }, opts));
    expect(appts.appointments.map((a) => a.title)).toEqual(["mine visit"]);
    expect(JSON.stringify([meds, labs, docs, found, appts])).not.toContain("INTRUDER");
  });

  it("write tools add a medication and log a dose, reporting what happened", async () => {
    const db = await freshDb();
    await db.insert(profile).values({ userId: USER, birthDate: "1990-01-01", sex: "male", timeZone: TZ, updatedAt: NOW });
    const t = medicalTools(ctxFor(db));
    expect(await run(t.add_medication.execute!({ name: "Metformine", dose: "500 mg", times: ["08:00", "20:00"], prn: false, reason: "glycémie" }, opts))).toEqual({ done: true, detail: "Metformine 500 mg" });
    const [m] = (await run(t.get_medications.execute!({ includePast: false }, opts))).medications;
    expect(m).toMatchObject({ name: "Metformine", startedOn: "2026-10-02", schedule: "08:00, 20:00" });
    expect(await run(t.log_medication_taken.execute!({ medicationId: m.id, status: "taken", at: "2026-10-02T08:10" }, opts))).toEqual({ done: true, detail: "Metformine: taken" });
    expect(await run(t.log_medication_taken.execute!({ medicationId: 999, status: "taken" }, opts))).toEqual({ done: false, error: "Not found" });
    expect((await run(t.get_medications.execute!({ includePast: false }, opts))).medications[0].today).toEqual({ due: ["08:00", "20:00"], taken: 1, skipped: 0 });
  });

  it("is part of the coach's tool set, documented, and its writes wait for approval", () => {
    const tools = coachTools(ctxFor(undefined as never));
    for (const name of ["get_medications", "get_lab_results", "get_documents", "search_documents", "get_appointments", ...MEDICAL_WRITE_TOOLS]) {
      expect(tools, name).toHaveProperty(name);
      expect(TOOL_DOCS, name).toHaveProperty(name);
    }
    for (const name of MEDICAL_WRITE_TOOLS) expect(coachApproval[name]).toBe("user-approval");
    expect(coachApproval).not.toHaveProperty("get_medications");
  });
});
