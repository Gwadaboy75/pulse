"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { confirmExtraction, discardExtraction, extractAgain } from "@/server/actions/medical"
import { DOCUMENT_KINDS, LAB_FLAGS } from "@/server/medical/extraction"
import type { DocumentDetailVM } from "@/server/queries/types"
import { SectionShell } from "@/components/shells/SectionShell"
import { Button } from "@/components/ui/button"
import { COPY } from "../../copy"
import { AREA, BODY, ERROR, Field, FIELD, HINT, LABEL, num, parseTimes, Select } from "../../form"

type Lab = { analyte: string; label: string; value: string; valueText: string; unit: string; refLow: string; refHigh: string; refText: string; flag: string }
type Med = { name: string; dose: string; form: string; route: string; times: string; prn: boolean; durationDays: string; reason: string }
type Appt = { title: string; date: string; time: string; location: string }
type Draft = { kind: string; title: string; date: string; practitioner: string; labName: string; summary: string; labs: Lab[]; medications: Med[]; appointments: Appt[] }

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v))
const EMPTY_LAB: Lab = { analyte: "", label: "", value: "", valueText: "", unit: "", refLow: "", refHigh: "", refText: "", flag: "" }
const EMPTY_MED: Med = { name: "", dose: "", form: "", route: "", times: "", prn: false, durationDays: "", reason: "" }
const EMPTY_APPT: Appt = { title: "", date: "", time: "", location: "" }

/** The stored extraction (whatever shape) as the form's draft; missing parts come up empty. */
function draftOf(doc: DocumentDetailVM): Draft {
  const x = (doc.extraction ?? {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  return {
    kind: s(x.kind) || doc.kind,
    title: s(x.title) || doc.title,
    date: s(x.date) || doc.day || "",
    practitioner: s(x.practitioner) || doc.practitioner || "",
    labName: s(x.labName),
    summary: s(x.summary),
    labs: arr(x.labs).map((l) => ({ analyte: s(l.analyte), label: s(l.label), value: s(l.value), valueText: s(l.valueText), unit: s(l.unit), refLow: s(l.refLow), refHigh: s(l.refHigh), refText: s(l.refText), flag: s(l.flag) })),
    medications: arr(x.medications).map((m) => ({ name: s(m.name), dose: s(m.dose), form: s(m.form), route: s(m.route), times: Array.isArray(m.times) ? m.times.join(", ") : "", prn: m.prn === true, durationDays: s(m.durationDays), reason: s(m.reason) })),
    appointments: arr(x.appointments).map((a) => ({ title: s(a.title), date: s(a.date), time: s(a.time), location: s(a.location) })),
  }
}

const key = (label: string) =>
  label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")

/** The draft as the Extraction schema wants it. */
function toExtraction(d: Draft) {
  return {
    kind: d.kind,
    title: d.title.trim(),
    date: d.date || null,
    practitioner: d.practitioner.trim() || null,
    labName: d.labName.trim() || null,
    labs: d.labs
      .filter((l) => l.label.trim())
      .map((l) => ({ analyte: l.analyte.trim() || key(l.label), label: l.label.trim(), value: num(l.value), valueText: l.valueText.trim() || null, unit: l.unit.trim() || null, refLow: num(l.refLow), refHigh: num(l.refHigh), refText: l.refText.trim() || null, flag: l.flag || null })),
    medications: d.medications
      .filter((m) => m.name.trim())
      .map((m) => ({ name: m.name.trim(), dose: m.dose.trim() || null, form: m.form.trim() || null, route: m.route.trim() || null, times: m.prn ? [] : parseTimes(m.times), prn: m.prn, durationDays: num(m.durationDays), reason: m.reason.trim() || null })),
    appointments: d.appointments.filter((a) => a.title.trim()).map((a) => ({ title: a.title.trim(), date: a.date || null, time: a.time || null, location: a.location.trim() || null })),
    summary: d.summary.trim(),
  }
}

const CELL = cn(FIELD, "h-11 px-3 text-[15px]")
const SMALL = "text-[11px] leading-4 font-bold tracking-[0.1em] text-muted-foreground uppercase"

/**
 * What the model read, line by line, editable: the person checks every value against the document, then confirms
 * (writes the results, medications and appointments) or discards. While the model is still reading, or when none is
 * set up, the form says so and can be filled by hand.
 */
export function ReviewForm({ doc }: { doc: DocumentDetailVM }) {
  const router = useRouter()
  const [d, setD] = React.useState<Draft>(() => draftOf(doc))
  const [pending, setPending] = React.useState<"confirm" | "discard" | "extract" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const c = COPY.documents
  const extracting = doc.status === "extracting" || doc.status === "uploaded"

  // The extraction runs after the upload's response: poll the page while it is still reading.
  React.useEffect(() => {
    if (!extracting) return
    const t = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(t)
  }, [extracting, router])
  // A fresh extraction landed: take it over the empty draft.
  const landed = React.useRef(doc.extraction)
  React.useEffect(() => {
    if (doc.extraction && doc.extraction !== landed.current) {
      landed.current = doc.extraction
      setD(draftOf(doc))
    }
  }, [doc])

  const run = async (what: "confirm" | "discard" | "extract") => {
    setPending(what)
    setError(null)
    const r = await (what === "confirm" ? confirmExtraction(doc.id, toExtraction(d)) : what === "discard" ? discardExtraction(doc.id) : extractAgain(doc.id)).catch(() => ({ ok: false as const, error: COPY.common.error }))
    setPending(null)
    if (!r.ok) return setError(r.error)
    if (what === "confirm") toast.success(c.confirmed)
    router.refresh()
  }
  const setLab = (i: number, k: keyof Lab, v: string) => setD({ ...d, labs: d.labs.map((l, j) => (j === i ? { ...l, [k]: v } : l)) })
  const setMed = (i: number, k: keyof Med, v: string | boolean) => setD({ ...d, medications: d.medications.map((m, j) => (j === i ? { ...m, [k]: v } : m)) })
  const setAppt = (i: number, k: keyof Appt, v: string) => setD({ ...d, appointments: d.appointments.map((a, j) => (j === i ? { ...a, [k]: v } : a)) })

  return (
    <div className="flex flex-col gap-4">
      <SectionShell variant="card" level={2} title={c.review}>
        {extracting ? (
          <p className={BODY} role="status" aria-live="polite">
            {c.extracting}
          </p>
        ) : doc.status === "failed" ? (
          <p className={cn(BODY, "text-warning-text")}>{c.failed(doc.error ?? "?")}</p>
        ) : doc.error?.startsWith("no_model") ? (
          <p className={cn(BODY, "text-warning-text")}>{c.noModel}</p>
        ) : (
          <p className={BODY}>{c.reviewIntro}</p>
        )}
        {!extracting && doc.canExtract && (
          <Button type="button" size="touch" variant="secondary" className="mt-3" disabled={pending !== null} onClick={() => run("extract")}>
            <RefreshCw aria-hidden /> {c.extractAgain}
          </Button>
        )}
      </SectionShell>

      {!extracting && (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void run("confirm")
          }}
        >
          <SectionShell variant="card" level={2} title={c.details}>
            <div className="flex flex-col gap-4">
              <Field id="rv-title" label={c.fields.title}>
                <input id="rv-title" className={FIELD} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="rv-kind" label={c.fields.kind}>
                  <Select id="rv-kind" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>
                    {DOCUMENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {COPY.kinds[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="rv-date" label={c.fields.day} optional>
                  <input id="rv-date" type="date" className={FIELD} value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field id="rv-practitioner" label={c.fields.practitioner} optional>
                  <input id="rv-practitioner" className={FIELD} value={d.practitioner} onChange={(e) => setD({ ...d, practitioner: e.target.value })} />
                </Field>
                <Field id="rv-lab" label={c.fields.labName} optional>
                  <input id="rv-lab" className={FIELD} value={d.labName} onChange={(e) => setD({ ...d, labName: e.target.value })} />
                </Field>
              </div>
              <Field id="rv-summary" label={c.fields.summary} optional>
                <textarea id="rv-summary" className={AREA} value={d.summary} onChange={(e) => setD({ ...d, summary: e.target.value })} />
              </Field>
            </div>
          </SectionShell>

          <SectionShell variant="card" level={2} title={`${c.labsFound} (${d.labs.length})`}>
            <div className="flex flex-col gap-3">
              {d.labs.map((l, i) => (
                <fieldset key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl bg-foreground/[0.04] p-3">
                  <legend className="sr-only">{l.label || `Ligne ${i + 1}`}</legend>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <label className="col-span-2 flex flex-col gap-1">
                      <span className={SMALL}>{COPY.labs.fields.label}</span>
                      <input className={CELL} value={l.label} onChange={(e) => setLab(i, "label", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>{COPY.labs.fields.value}</span>
                      <input className={CELL} value={l.value} onChange={(e) => setLab(i, "value", e.target.value)} inputMode="decimal" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>{COPY.labs.fields.unit}</span>
                      <input className={CELL} value={l.unit} onChange={(e) => setLab(i, "unit", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>{COPY.labs.fields.refLow}</span>
                      <input className={CELL} value={l.refLow} onChange={(e) => setLab(i, "refLow", e.target.value)} inputMode="decimal" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>{COPY.labs.fields.refHigh}</span>
                      <input className={CELL} value={l.refHigh} onChange={(e) => setLab(i, "refHigh", e.target.value)} inputMode="decimal" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>{COPY.labs.fields.valueText}</span>
                      <input className={CELL} value={l.valueText} onChange={(e) => setLab(i, "valueText", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>Flag</span>
                      <Select className={CELL} value={l.flag} onChange={(e) => setLab(i, "flag", e.target.value)}>
                        <option value="">—</option>
                        {LAB_FLAGS.map((f) => (
                          <option key={f} value={f}>
                            {COPY.flags[f]}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                  <Button type="button" size="icon-touch" variant="ghost" aria-label="Retirer" className="self-start text-muted-foreground" onClick={() => setD({ ...d, labs: d.labs.filter((_, j) => j !== i) })}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </fieldset>
              ))}
              <Button type="button" size="touch" variant="secondary" className="self-start" onClick={() => setD({ ...d, labs: [...d.labs, EMPTY_LAB] })}>
                <Plus aria-hidden /> {c.addLine}
              </Button>
            </div>
          </SectionShell>

          <SectionShell variant="card" level={2} title={`${c.medicationsFound} (${d.medications.length})`}>
            <div className="flex flex-col gap-3">
              {d.medications.map((m, i) => (
                <fieldset key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl bg-foreground/[0.04] p-3">
                  <legend className="sr-only">{m.name || `Ligne ${i + 1}`}</legend>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <label className="col-span-2 flex flex-col gap-1">
                      <span className={SMALL}>{COPY.medications.fields.name}</span>
                      <input className={CELL} value={m.name} onChange={(e) => setMed(i, "name", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>{COPY.medications.fields.dose}</span>
                      <input className={CELL} value={m.dose} onChange={(e) => setMed(i, "dose", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>{COPY.medications.fields.form}</span>
                      <input className={CELL} value={m.form} onChange={(e) => setMed(i, "form", e.target.value)} />
                    </label>
                    <label className="col-span-2 flex flex-col gap-1">
                      <span className={SMALL}>{COPY.medications.fields.times}</span>
                      <input className={CELL} value={m.times} onChange={(e) => setMed(i, "times", e.target.value)} placeholder="08:00, 20:00" disabled={m.prn} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>Durée (jours)</span>
                      <input className={CELL} value={m.durationDays} onChange={(e) => setMed(i, "durationDays", e.target.value)} inputMode="numeric" />
                    </label>
                    <label className="flex items-center gap-2 self-end pb-3 text-[15px]">
                      <input type="checkbox" checked={m.prn} onChange={(e) => setMed(i, "prn", e.target.checked)} className="size-5 accent-foreground" />
                      {COPY.medications.asNeeded}
                    </label>
                    <label className="col-span-2 flex flex-col gap-1 md:col-span-4">
                      <span className={SMALL}>{COPY.medications.fields.reason}</span>
                      <input className={CELL} value={m.reason} onChange={(e) => setMed(i, "reason", e.target.value)} />
                    </label>
                  </div>
                  <Button type="button" size="icon-touch" variant="ghost" aria-label="Retirer" className="self-start text-muted-foreground" onClick={() => setD({ ...d, medications: d.medications.filter((_, j) => j !== i) })}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </fieldset>
              ))}
              <Button type="button" size="touch" variant="secondary" className="self-start" onClick={() => setD({ ...d, medications: [...d.medications, EMPTY_MED] })}>
                <Plus aria-hidden /> {c.addLine}
              </Button>
            </div>
          </SectionShell>

          <SectionShell variant="card" level={2} title={`${c.appointmentsFound} (${d.appointments.length})`}>
            <div className="flex flex-col gap-3">
              {d.appointments.map((a, i) => (
                <fieldset key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl bg-foreground/[0.04] p-3">
                  <legend className="sr-only">{a.title || `Ligne ${i + 1}`}</legend>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <label className="col-span-2 flex flex-col gap-1">
                      <span className={SMALL}>{COPY.appointments.fields.title}</span>
                      <input className={CELL} value={a.title} onChange={(e) => setAppt(i, "title", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>Date</span>
                      <input type="date" className={CELL} value={a.date} onChange={(e) => setAppt(i, "date", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={SMALL}>Heure</span>
                      <input type="time" className={CELL} value={a.time} onChange={(e) => setAppt(i, "time", e.target.value)} />
                    </label>
                    <label className="col-span-2 flex flex-col gap-1 md:col-span-4">
                      <span className={SMALL}>{COPY.appointments.fields.location}</span>
                      <input className={CELL} value={a.location} onChange={(e) => setAppt(i, "location", e.target.value)} />
                    </label>
                  </div>
                  <Button type="button" size="icon-touch" variant="ghost" aria-label="Retirer" className="self-start text-muted-foreground" onClick={() => setD({ ...d, appointments: d.appointments.filter((_, j) => j !== i) })}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </fieldset>
              ))}
              <Button type="button" size="touch" variant="secondary" className="self-start" onClick={() => setD({ ...d, appointments: [...d.appointments, EMPTY_APPT] })}>
                <Plus aria-hidden /> {c.addLine}
              </Button>
            </div>
          </SectionShell>

          {error && (
            <p role="alert" className={ERROR}>
              {error}
            </p>
          )}
          <div className="flex flex-col gap-3 md:flex-row-reverse">
            <Button type="submit" size="sheet" className="md:w-auto" disabled={pending !== null}>
              {pending === "confirm" ? COPY.common.saving : c.confirm}
            </Button>
            <Button type="button" variant="outline-pill" size="sheet" className="md:w-auto" disabled={pending !== null} onClick={() => run("discard")}>
              {c.discard}
            </Button>
          </div>
          <p className={cn(HINT, LABEL, "sr-only")}>{c.reviewIntro}</p>
        </form>
      )}
    </div>
  )
}
