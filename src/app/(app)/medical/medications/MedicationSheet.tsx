"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { deleteMedication, saveMedication, setMedicationActive } from "@/server/actions/medical"
import type { MedicationVM } from "@/server/queries/types"
import { Button } from "@/components/ui/button"
import { COPY } from "../copy"
import { AREA, Field, FIELD, FormSheet, parseTimes } from "../form"

type Draft = { name: string; dose: string; form: string; route: string; times: string; prn: boolean; startedOn: string; endedOn: string; reason: string; notes: string; practitioner: string }

const draftOf = (m?: MedicationVM): Draft => ({
  name: m?.name ?? "",
  dose: m?.dose ?? "",
  form: m?.form ?? "",
  route: m?.route ?? "",
  times: m?.schedule?.times.join(", ") ?? "",
  prn: m?.schedule?.prn ?? false,
  startedOn: m?.startedOn ?? "",
  endedOn: m?.endedOn ?? "",
  reason: m?.reason ?? "",
  notes: m?.notes ?? "",
  practitioner: m?.practitioner ?? "",
})

/** Add (no `medication`) or edit a medication in a sheet; editing offers Delete. */
export function MedicationSheet({ medication, trigger = "add" }: { medication?: MedicationVM; trigger?: "add" | "edit" }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [d, setD] = React.useState<Draft>(() => draftOf(medication))
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value })
  const c = COPY.medications
  const f = c.fields
  return (
    <>
      {trigger === "add" ? (
        <Button size="touch" variant="secondary" onClick={() => (setD(draftOf()), setOpen(true))}>
          <Plus aria-hidden /> {c.add}
        </Button>
      ) : (
        <Button size="icon-touch" variant="ghost" aria-label={c.edit} onClick={() => (setD(draftOf(medication)), setOpen(true))}>
          <Pencil aria-hidden strokeWidth={1.75} />
        </Button>
      )}
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={medication ? c.edit : c.add}
        onSubmit={() =>
          saveMedication({
            id: medication?.id,
            name: d.name,
            dose: d.dose,
            form: d.form,
            route: d.route,
            times: d.prn ? [] : parseTimes(d.times),
            prn: d.prn,
            startedOn: d.startedOn || null,
            endedOn: d.endedOn || null,
            reason: d.reason,
            notes: d.notes,
            practitioner: d.practitioner,
          })
        }
        onSaved={() => {
          toast.success(COPY.common.save)
          router.refresh()
        }}
        destructive={
          medication && {
            label: c.delete,
            confirm: c.deleteConfirm,
            run: async () => {
              const r = await deleteMedication(medication.id)
              if (r.ok) router.refresh()
              return r
            },
          }
        }
      >
        <Field id="med-name" label={f.name} hint={c.hints.name}>
          <input id="med-name" className={FIELD} value={d.name} onChange={set("name")} autoComplete="off" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="med-dose" label={f.dose} hint={c.hints.dose} optional>
            <input id="med-dose" className={FIELD} value={d.dose} onChange={set("dose")} />
          </Field>
          <Field id="med-form" label={f.form} optional>
            <input id="med-form" className={FIELD} value={d.form} onChange={set("form")} placeholder="comprimé" />
          </Field>
        </div>
        <Field id="med-times" label={f.times} hint={c.hints.times} optional>
          <input id="med-times" className={FIELD} value={d.times} onChange={set("times")} placeholder="08:00, 20:00" disabled={d.prn} inputMode="numeric" />
        </Field>
        <label className="flex items-center gap-3 text-[15px] leading-[22px]">
          <input type="checkbox" checked={d.prn} onChange={set("prn")} className="size-5 accent-foreground" />
          {f.prn}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field id="med-start" label={f.startedOn} optional>
            <input id="med-start" type="date" className={FIELD} value={d.startedOn} onChange={set("startedOn")} />
          </Field>
          <Field id="med-end" label={f.endedOn} optional>
            <input id="med-end" type="date" className={FIELD} value={d.endedOn} onChange={set("endedOn")} />
          </Field>
        </div>
        <Field id="med-reason" label={f.reason} hint={c.hints.reason} optional>
          <input id="med-reason" className={FIELD} value={d.reason} onChange={set("reason")} />
        </Field>
        <Field id="med-practitioner" label={f.practitioner} optional>
          <input id="med-practitioner" className={FIELD} value={d.practitioner} onChange={set("practitioner")} />
        </Field>
        <Field id="med-notes" label={f.notes} optional>
          <textarea id="med-notes" className={AREA} value={d.notes} onChange={set("notes")} />
        </Field>
      </FormSheet>
    </>
  )
}

/** Stops (today) or resumes a medication. */
export function ActiveToggle({ medication }: { medication: MedicationVM }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const run = async () => {
    setPending(true)
    const r = await setMedicationActive(medication.id, !medication.active).catch(() => ({ ok: false as const, error: COPY.common.error }))
    setPending(false)
    if (!r.ok) return toast.error(r.error)
    router.refresh()
  }
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={run}>
      {medication.active ? COPY.medications.stop : COPY.medications.resume}
    </Button>
  )
}
