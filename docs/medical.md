# Médical: your own medical file

The **Médical** tab (this fork's fifth tab) keeps the person's medical file beside the band's data: lab results,
medications and the doses taken, documents (prescriptions, blood tests, imaging reports, letters) and appointments,
with the coach able to read it on request. The screens are in French; this page is in English like the rest of the
docs.

Nothing here feeds a score. Pulse stores and shows; it does not diagnose, and the coach is told not to.

## Screens

| Screen | What it does |
|---|---|
| `/medical` | Today's doses to take (with one-tap "pris" / "sauté"), the next appointment, the latest results out of their range, recent documents, and the counts. |
| `/medical/labs` | One row per analyte with its latest value, flag and move since the result before. Each opens its history: the latest value against the printed range, a chart of every numeric result over the latest range, and the list with links to the documents they came from. Results can be typed by hand. |
| `/medical/medications` | Active and past medications: dose, form, schedule (clock times, weekdays, or as needed), start and end, who prescribed it, the doses logged today, stop / resume, edit, delete. |
| `/medical/documents` | Upload a PDF or a photo (JPEG, PNG, WebP; phone photos are downscaled in the browser first). Each document opens on its own page with the file viewer, its details and, while it awaits review, the read-out form. |
| `/medical/appointments` | Upcoming and past appointments, add / edit / mark done or cancelled. |

## Reading a document

When a document is uploaded, Pulse sends it to the **coach's model** (the provider and key the person set up under
Settings › Coach; the coach must be enabled for them in the admin panel) as a file, with a fixed prompt asking for a
structured reading: the document's kind, title and date, the practitioner and lab, every lab result with its printed
unit and reference range, every medication with dose, form, times and duration, any appointment, and a two-sentence
summary. The answer is validated against the schema in `src/server/medical/extraction.ts`.

The reading lands on the document for **review**: every line is shown as an editable form, nothing is written to the
lab, medication or appointment tables until the person taps **Confirmer**. They can also discard it (the document is
kept, nothing read out of it), or run the reading again. Confirming again later replaces what the document wrote
before. Without a coach model the form opens empty, to fill by hand.

Anthropic, OpenAI and Google models read PDFs and images directly. A local model (COACH_LOCAL_URL) or OpenRouter may
not accept a file: the reading then fails by name and the form is filled by hand.

Analytes are keyed by a stable English `snake_case` key the model assigns (`hemoglobin`, `ldl_cholesterol`, `tsh`),
so the same test lines up across labs that print it differently; results typed by hand are keyed from their label.
A result's flag is the printed one, else low / normal / high against the printed range.

## Blood age and derived calculators

`/medical/bloodage` computes the clinical **PhenoAge** (Levine 2018) from the latest result of each of its nine
markers on file, converted to the model's units with every conversion shown, and `/medical/labs` shows the derived
calculators whose inputs exist (CKD-EPI 2021 eGFR, non-HDL, TyG, HOMA-IR). A marker in an unknown unit is missing,
never guessed; a "< x" result is taken as half the limit, and the rule is shown. The formula, the two published
denominators (0.090165 by default, the 2019 erratum's 0.09165 as a named variant in Settings › Calculs) and the
aliases are in [formulas.md](formulas.md). The coach reads it through `get_blood_age`, as a group-level estimate,
never merged with Pulse Age.

## The coach

Five read tools (`get_medications`, `get_lab_results`, `get_documents`, `search_documents`, `get_appointments`) and
two write tools (`log_medication_taken`, `add_medication`, each confirmed by a tap in the chat, like the log tools).
The instructions (`src/server/coach/texts.ts`, editable from the admin panel) tell the coach to read the file only
when the question is about it, to compare a result only with its printed range and the person's own history, never
to suggest starting, stopping or changing a medication, and to send interaction, side-effect and symptom questions to
the prescriber or pharmacist.

## Storage and backup

Files live under `DOCUMENTS_DIR` (`data/documents` in development, the `pulse-docs` volume in compose), one folder per
user, named by a random id. The database row holds the path, the kind, the dates, the reading and its status. The
maximum upload is `DOCUMENTS_MAX_BYTES` (25 MB by default); a proxy in front of Pulse must allow at least that.

Back up the volume beside the database ([admin.md](admin.md#backups)); the dump now holds medical data, so keep copies
encrypted when they leave the server. Deleting a document removes its file; the results and medications confirmed
from it stay, unlinked, as the person's record.

## Tables

`practitioners`, `medical_documents`, `lab_results`, `medications`, `medication_events`, `appointments` (migration
0011). Every row belongs to one user and cascades with the account.
