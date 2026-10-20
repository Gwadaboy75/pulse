// What the model reads out of a document, as a schema both the extractor (extract.ts) and the review form's
// confirmation (actions/medical.ts) validate against. Nothing in it reaches the tables until the person confirms.
import { z } from "zod";

export const DOCUMENT_KINDS = ["lab_report", "prescription", "imaging", "letter", "other"] as const;
export const LAB_FLAGS = ["low", "normal", "high", "abnormal"] as const;

const str = (max: number) => z.string().trim().max(max);
const opt = (max: number) => str(max).nullable().default(null);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

export const ExtractedLab = z.object({
  /** The analyte as a stable English snake_case key, so the same test lines up across labs: `hemoglobin`, `ldl_cholesterol`, `tsh`, `hba1c`, `vitamin_d`, `creatinine`. */
  analyte: str(64).regex(/^[a-z0-9_]+$/, "a snake_case key"),
  /** The test's name as the report prints it. */
  label: str(120),
  value: z.number().finite().nullable().default(null),
  /** A result that is not a number ("negative", "trace", "< 0.1"). */
  valueText: opt(64),
  unit: opt(32),
  refLow: z.number().finite().nullable().default(null),
  refHigh: z.number().finite().nullable().default(null),
  /** The reference as printed when it is not a plain low–high. */
  refText: opt(64),
  flag: z.enum(LAB_FLAGS).nullable().default(null),
});

export const ExtractedMedication = z.object({
  name: str(120),
  dose: opt(64),
  form: opt(40),
  route: opt(40),
  /** Clock times to take it, `HH:MM`; empty when not given or as needed. */
  times: z.array(clock).max(8).default([]),
  prn: z.boolean().default(false),
  durationDays: z.number().int().min(1).max(3650).nullable().default(null),
  reason: opt(160),
});

export const ExtractedAppointment = z.object({
  title: str(120),
  date: z.iso.date().nullable().default(null),
  time: clock.nullable().default(null),
  location: opt(160),
});

export const Extraction = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  /** A short title in the document's language: "Prise de sang, 12 mars 2026". */
  title: str(120),
  /** The document's own date (sample date, prescription date), `YYYY-MM-DD`. */
  date: z.iso.date().nullable().default(null),
  practitioner: opt(120),
  labName: opt(120),
  labs: z.array(ExtractedLab).max(200).default([]),
  medications: z.array(ExtractedMedication).max(50).default([]),
  appointments: z.array(ExtractedAppointment).max(20).default([]),
  /** Two or three sentences on what the document says, in its language. No diagnosis. */
  summary: str(1000).default(""),
});

export type Extraction = z.infer<typeof Extraction>;
export type ExtractedLab = z.infer<typeof ExtractedLab>;
export type ExtractedMedication = z.infer<typeof ExtractedMedication>;
export type LabFlag = (typeof LAB_FLAGS)[number];

/** The flag a result carries: the printed one, else by the range when the value and both bounds are numbers. */
export function flagOf(l: { value: number | null; refLow: number | null; refHigh: number | null; flag: LabFlag | null }): LabFlag | null {
  if (l.flag) return l.flag;
  if (l.value === null) return null;
  if (l.refLow !== null && l.value < l.refLow) return "low";
  if (l.refHigh !== null && l.value > l.refHigh) return "high";
  if (l.refLow !== null || l.refHigh !== null) return "normal";
  return null;
}

/** A label as an analyte key, for results typed by hand: "LDL cholestérol" → `ldl_cholesterol`. */
export function analyteKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64) || "unknown";
}
