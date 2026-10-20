"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ACTIVITY_LEVELS, RMR_EQUATIONS } from "@/core/formulas/metabolism"
import { HRV_REFERENCE_METHODS } from "@/core/formulas/hrvReference"
import { PHENO_VARIANTS } from "@/core/formulas/phenoage"
import { STRAIN_METHODS } from "@/core/scoring/strain"
import type { CalcSettings } from "@/server/calc"
import { saveCalcAction } from "@/server/actions/calc"
import { Button } from "@/components/ui/button"
import { ResponsiveSheet } from "@/components/shells/ResponsiveSheet"
import { ACTIVITY_LABEL, COPY, HRV_METHOD_LABEL, PHENO_VARIANT_LABEL, RMR_LABEL, STRAIN_METHOD_LABEL } from "../_lib/formulas.copy"

const FIELD =
  "h-13 w-full min-w-0 appearance-none rounded-xl bg-field px-4 text-[17px] leading-6 text-foreground outline-none transition-[box-shadow] duration-150 ease-standard focus-visible:ring-2 focus-visible:ring-foreground/70"
const LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase"
const HINT = "text-[13px] leading-[18px] text-muted-foreground text-pretty"

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  )
}

/** The Modifier button on Settings › Calculs and its sheet: one native select per choice, saved together. */
export function EditCalcButton({ defaults, profileSex }: { defaults: CalcSettings; profileSex: "male" | "female" }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [v, setV] = React.useState<CalcSettings>(defaults)
  // The sheet starts from what is saved each time it opens (no effect: set on the click that opens it).
  const show = () => {
    setV(defaults)
    setOpen(true)
  }
  const c = COPY.calc
  const set = <K extends keyof CalcSettings>(k: K, value: CalcSettings[K]) => setV((s) => ({ ...s, [k]: value }))
  const save = async () => {
    setPending(true)
    const r = await saveCalcAction(v).catch(() => ({ ok: false as const, error: c.error }))
    setPending(false)
    if (!r.ok) return toast.error(r.error || c.error)
    setOpen(false)
    toast.success(r.data.recompute ? c.savedRecompute : c.saved)
    router.refresh()
  }
  return (
    <>
      <Button
        variant="ghost"
        aria-label={c.edit}
        onClick={show}
        className="relative -my-2 h-9 gap-1.5 rounded-full px-3 after:absolute after:-inset-y-1 text-[13px] font-semibold text-foreground-secondary hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <Pencil aria-hidden strokeWidth={2} className="size-3.5" />
        {c.edit}
      </Button>
      <ResponsiveSheet
        open={open}
        onOpenChange={(o) => !pending && setOpen(o)}
        title={c.sheetTitle}
        description={c.sheetDescription}
        size="tall"
        footer={
          <Button size="sheet" onClick={save} disabled={pending} aria-busy={pending || undefined}>
            {pending ? "…" : c.save}
          </Button>
        }
      >
        <div className="flex flex-col gap-5 px-4 pb-4 md:px-6">
          <Field id="calc-strain" label={c.strain} hint={STRAIN_METHOD_LABEL[v.strainMethod].hint}>
            <select id="calc-strain" className={FIELD} value={v.strainMethod} onChange={(e) => set("strainMethod", e.target.value as CalcSettings["strainMethod"])}>
              {STRAIN_METHODS.map((m) => (
                <option key={m} value={m}>
                  {STRAIN_METHOD_LABEL[m].label}
                  {m !== "edwards" && profileSex === "female" ? " · k = 1,67" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field id="calc-rmr" label={c.rmr}>
            <select id="calc-rmr" className={FIELD} value={v.rmrEquation} onChange={(e) => set("rmrEquation", e.target.value as CalcSettings["rmrEquation"])}>
              {RMR_EQUATIONS.map((m) => (
                <option key={m} value={m}>
                  {RMR_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="calc-activity" label={c.activity} hint={`${ACTIVITY_LABEL[v.activityLevel].hint} ${c.activityHint}`}>
            <select id="calc-activity" className={FIELD} value={v.activityLevel} onChange={(e) => set("activityLevel", e.target.value as CalcSettings["activityLevel"])}>
              {ACTIVITY_LEVELS.map((m) => (
                <option key={m} value={m}>
                  {ACTIVITY_LABEL[m].label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="calc-pheno" label={c.phenoage} hint={PHENO_VARIANT_LABEL[v.phenoageVariant].hint}>
            <select id="calc-pheno" className={FIELD} value={v.phenoageVariant} onChange={(e) => set("phenoageVariant", e.target.value as CalcSettings["phenoageVariant"])}>
              {PHENO_VARIANTS.map((m) => (
                <option key={m} value={m}>
                  {PHENO_VARIANT_LABEL[m].label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="calc-hrv" label={c.hrvMethod} hint={HRV_METHOD_LABEL[v.hrvReferenceMethod].hint}>
            <select id="calc-hrv" className={FIELD} value={v.hrvReferenceMethod} onChange={(e) => set("hrvReferenceMethod", e.target.value as CalcSettings["hrvReferenceMethod"])}>
              {HRV_REFERENCE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {HRV_METHOD_LABEL[m].label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="calc-hrv-days" label={c.hrvDays} hint={c.hrvDaysHint}>
            <input
              id="calc-hrv-days"
              type="number"
              inputMode="numeric"
              min={28}
              max={60}
              className={cn(FIELD, "tabular-nums")}
              value={v.hrvReferenceDays}
              onChange={(e) => set("hrvReferenceDays", Math.min(60, Math.max(28, Number(e.target.value) || 28)))}
            />
          </Field>
        </div>
      </ResponsiveSheet>
    </>
  )
}
