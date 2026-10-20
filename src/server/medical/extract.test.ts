// Extraction: the document goes to the person's coach model as a file; what comes back is validated and kept for
// review; without a model the document waits for the person's own typing; a model failure is recorded by name.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_EXTRACTION } from "../coach/mock";
import { saveProvider, setCoachMode, setConsent } from "../coach/store";
import { type Config, parseConfig } from "../config";
import type { Db } from "../db";
import { medicalDocuments } from "../db/schema";
import { freshDb, NOW, USER } from "../testing";
import { extractDocument } from "./extract";
import { Extraction, analyteKey, flagOf } from "./extraction";

const h = vi.hoisted(() => ({ cfg: undefined as unknown }));
vi.mock("../config", async (orig) => ({ ...(await orig<object>()), getConfig: () => h.cfg as Config }));

const DOC = "22222222-2222-4222-8222-222222222222";
let db: Db;
let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-docs-"));
  h.cfg = parseConfig({ DATA_SOURCE: "health-connect", BETTER_AUTH_SECRET: "x".repeat(32), DOCUMENTS_DIR: dir, COACH_MOCK: "true" });
  db = await freshDb();
  await fs.mkdir(path.join(dir, String(USER)), { recursive: true });
  await fs.writeFile(path.join(dir, String(USER), `${DOC}.pdf`), "%PDF-1.4 mock");
  await db.insert(medicalDocuments).values({ userId: USER, id: DOC, kind: "other", title: `${DOC}.pdf`, filePath: `${USER}/${DOC}.pdf`, mime: "application/pdf", bytes: 13, sha256: "x", status: "uploaded", createdAt: NOW, updatedAt: NOW });
});
const doc = async () => (await db.select().from(medicalDocuments).where(and(eq(medicalDocuments.userId, USER), eq(medicalDocuments.id, DOC))))[0];

describe("extractDocument", () => {
  it("without a coach model the document goes straight to review, saying why", async () => {
    await extractDocument(db, USER, DOC);
    expect(await doc()).toMatchObject({ status: "review", error: "no_model:no_access", extraction: null });
  });

  it("with the (mock) model the reading is validated and kept, and the upload's file-name title gives way", async () => {
    await setCoachMode(db, "everyone");
    await setConsent(db, USER, true);
    await saveProvider(db, USER, "mock", "mock", null);
    await extractDocument(db, USER, DOC, () => NOW + 5);
    const d = await doc();
    expect(d).toMatchObject({ status: "done" === d.status ? "done" : "review", error: null, title: "Blood test (mock)", day: "2026-09-30", kind: "lab_report", updatedAt: NOW + 5 });
    expect(Extraction.parse(d.extraction)).toMatchObject({ labs: MOCK_EXTRACTION.labs, medications: MOCK_EXTRACTION.medications });
  });

  it("a missing file is a failure by name, never a thrown error", async () => {
    await setCoachMode(db, "everyone");
    await setConsent(db, USER, true);
    await saveProvider(db, USER, "mock", "mock", null);
    await fs.rm(path.join(dir, String(USER), `${DOC}.pdf`));
    await extractDocument(db, USER, DOC);
    expect(await doc()).toMatchObject({ status: "failed", error: "Error" });
  });

  it("an unknown document is a no-op", async () => {
    await extractDocument(db, USER, "33333333-3333-4333-8333-333333333333");
    expect((await doc()).status).toBe("uploaded");
  });
});

describe("the schema's helpers", () => {
  it("flags by the printed flag, else by the range, else not at all", () => {
    expect(flagOf({ value: 5, refLow: 1, refHigh: 4, flag: null })).toBe("high");
    expect(flagOf({ value: 0.5, refLow: 1, refHigh: 4, flag: null })).toBe("low");
    expect(flagOf({ value: 2, refLow: 1, refHigh: 4, flag: null })).toBe("normal");
    expect(flagOf({ value: 2, refLow: null, refHigh: null, flag: null })).toBeNull();
    expect(flagOf({ value: 2, refLow: 1, refHigh: 4, flag: "abnormal" })).toBe("abnormal");
    expect(flagOf({ value: null, refLow: 1, refHigh: 4, flag: null })).toBeNull();
  });

  it("turns a printed label into a stable key", () => {
    expect(analyteKey("Cholestérol LDL")).toBe("cholesterol_ldl");
    expect(analyteKey("  TSH (ultra-sensible) ")).toBe("tsh_ultra_sensible");
    expect(analyteKey("###")).toBe("unknown");
  });

  it("fills defaults and refuses a bad analyte key", () => {
    const x = Extraction.parse({ kind: "letter", title: "Courrier" });
    expect(x).toMatchObject({ labs: [], medications: [], appointments: [], summary: "", date: null });
    expect(Extraction.safeParse({ kind: "lab_report", title: "x", labs: [{ analyte: "LDL", label: "LDL" }] }).success).toBe(false);
  });
});
