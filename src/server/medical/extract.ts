// Reads a document with the person's own coach model (the provider and key they set up for the coach): the PDF or
// photo goes to the model as a file part, and the answer is validated against the Extraction schema. The result is
// kept on the document for review; nothing is written into the lab, medication or appointment tables here.
import { generateText, Output } from "ai";
import { and, eq } from "drizzle-orm";
import { coachModel } from "../coach/store";
import type { Db } from "../db";
import { medicalDocuments } from "../db/schema";
import { Extraction } from "./extraction";
import { readDocument } from "./storage";

const TIMEOUT_MS = 180_000;

export const PROMPT = `You are reading one page or document from a person's own medical file: a lab report (blood test), a prescription, an imaging report, a letter from a practitioner, or something else. Read it carefully and fill the schema.

Rules:
- Keep the document's own language for \`title\`, \`label\`, \`summary\`, names and reasons. The \`analyte\` key alone is a stable English snake_case identifier (hemoglobin, hematocrit, ldl_cholesterol, hdl_cholesterol, triglycerides, glucose_fasting, hba1c, tsh, ferritin, vitamin_d, creatinine, alt, ast, crp, ...), the same for the same test whatever the lab calls it.
- Copy numbers exactly as printed, with the printed unit. Put a non-numeric result in \`valueText\`. Reference ranges: \`refLow\` and \`refHigh\` when the range is low–high; otherwise \`refText\` as printed. \`flag\` only when the report marks the result (an asterisk, H/L, bold), else null.
- Medications: one entry per product, with the dose and form as printed, the clock times when the prescription gives them (morning → 08:00, midday → 12:00, evening → 19:00, bedtime → 22:00), \`prn\` for "as needed", and the duration in days when stated.
- \`date\` is the document's own date (sample date, prescription date), not today.
- \`summary\`: two or three plain sentences on what the document contains. No diagnosis, no advice, no interpretation beyond what is printed.
- Leave out what is not there. Never invent a value.`;

/** Runs the extraction for one document and stores the outcome on it. Safe to call again (a retry). */
export async function extractDocument(db: Db, userId: number, id: string, now = () => Math.floor(Date.now() / 1000)): Promise<void> {
  const where = and(eq(medicalDocuments.userId, userId), eq(medicalDocuments.id, id));
  const [doc] = await db.select().from(medicalDocuments).where(where);
  if (!doc) return;
  const m = await coachModel(db, userId);
  if ("problem" in m) {
    // No model to read it: the person fills the review form by hand (the form says why).
    await db.update(medicalDocuments).set({ status: "review", error: `no_model:${m.problem}`, updatedAt: now() }).where(where);
    return;
  }
  await db.update(medicalDocuments).set({ status: "extracting", error: null, updatedAt: now() }).where(where);
  try {
    const bytes = await readDocument(doc.filePath);
    const { output, text } = await generateText({
      model: m.model,
      output: Output.object({ schema: Extraction }),
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "file", mediaType: doc.mime, data: bytes }] }],
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!output) throw new Error("no_output");
    await db
      .update(medicalDocuments)
      .set({
        extraction: output,
        extractedText: text || null,
        status: "review",
        error: null,
        // The upload's title is the file name; the model's is better. The person edits either at review.
        ...(doc.title === doc.filePath.split("/").at(-1) && output.title && { title: output.title }),
        ...(doc.day === null && output.date && { day: output.date }),
        ...(doc.kind === "other" && { kind: output.kind }),
        updatedAt: now(),
      })
      .where(where);
  } catch (err) {
    // The name only: a provider error can echo the request, and the request is the document.
    const name = err instanceof Error ? err.name : "error";
    console.warn(`[medical] extraction of document ${id} for user ${userId} failed: ${name}`);
    await db.update(medicalDocuments).set({ status: "failed", error: name, updatedAt: now() }).where(where);
  }
}
