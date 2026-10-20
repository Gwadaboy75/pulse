"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { saveLabResult } from "@/server/actions/medical"
import { Button } from "@/components/ui/button"
import { COPY } from "../copy"
import { Field, FIELD, FormSheet, num } from "../form"

/** Type one result by hand (a value the lab gave on paper, a home measurement). */
export function LabSheet({ label: presetLabel, analyte, unit: presetUnit }: { label?: string; analyte?: string; unit?: string | null }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [d, setD] = React.useState({ day: today, label: presetLabel ?? "", value: "", valueText: "", unit: presetUnit ?? "", refLow: "", refHigh: "", labName: "" })
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value })
  const c = COPY.labs
  return (
    <>
      <Button size="touch" variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {c.add}
      </Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={c.add}
        onSubmit={() => saveLabResult({ day: d.day, label: d.label, analyte, value: num(d.value), valueText: d.valueText, unit: d.unit, refLow: num(d.refLow), refHigh: num(d.refHigh), labName: d.labName })}
        onSaved={() => {
          toast.success(COPY.common.save)
          setD({ ...d, value: "", valueText: "" })
          router.refresh()
        }}
      >
        <Field id="lab-day" label={c.fields.day}>
          <input id="lab-day" type="date" className={FIELD} value={d.day} max={today} onChange={set("day")} required />
        </Field>
        <Field id="lab-label" label={c.fields.label} hint={c.hints.label}>
          <input id="lab-label" className={FIELD} value={d.label} onChange={set("label")} readOnly={!!presetLabel} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="lab-value" label={c.fields.value} hint={c.hints.value}>
            <input id="lab-value" className={FIELD} value={d.value} onChange={set("value")} inputMode="decimal" />
          </Field>
          <Field id="lab-unit" label={c.fields.unit} optional>
            <input id="lab-unit" className={FIELD} value={d.unit} onChange={set("unit")} placeholder="g/L" />
          </Field>
        </div>
        <Field id="lab-text" label={c.fields.valueText} hint={c.hints.valueText} optional>
          <input id="lab-text" className={FIELD} value={d.valueText} onChange={set("valueText")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="lab-low" label={c.fields.refLow} hint={c.hints.range} optional>
            <input id="lab-low" className={FIELD} value={d.refLow} onChange={set("refLow")} inputMode="decimal" />
          </Field>
          <Field id="lab-high" label={c.fields.refHigh} optional>
            <input id="lab-high" className={FIELD} value={d.refHigh} onChange={set("refHigh")} inputMode="decimal" />
          </Field>
        </div>
        <Field id="lab-name" label={c.fields.labName} optional>
          <input id="lab-name" className={FIELD} value={d.labName} onChange={set("labName")} />
        </Field>
      </FormSheet>
    </>
  )
}
