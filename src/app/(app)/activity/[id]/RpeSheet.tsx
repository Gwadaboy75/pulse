"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Gauge } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { CR10 } from "@/core/formulas/sessionLoad"
import { setActivityFeedbackAction } from "@/server/actions/activity"
import { Button } from "@/components/ui/button"
import { ResponsiveSheet } from "@/components/shells/ResponsiveSheet"
import { COPY } from "../../_lib/formulas.copy"

const LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase"
const AREA =
  "min-h-20 w-full rounded-xl bg-field px-4 py-3 text-[17px] leading-6 text-foreground outline-none transition-[box-shadow] duration-150 ease-standard placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-foreground/70"

/** The activity's "Effort ressenti" pill and sheet: a CR-10 scale (0–10 by half points) and a note. */
export function RpeSheet({ exerciseId, rpe, note, minutes }: { exerciseId: string; rpe: number | null; note: string | null; minutes: number }) {
  const router = useRouter()
  const c = COPY.rpe
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [value, setValue] = React.useState<number>(rpe ?? 5)
  const [text, setText] = React.useState(note ?? "")
  // The sheet starts from the saved rating each time it opens (set on the click that opens it, not in an effect).
  const show = () => {
    setValue(rpe ?? 5)
    setText(note ?? "")
    setOpen(true)
  }
  const anchor = CR10.filter(([v]) => v <= value).at(-1)?.[1] ?? ""
  const save = async (clear = false) => {
    setPending(true)
    const r = await setActivityFeedbackAction({ exerciseId, rpe: clear ? null : value, note: clear ? null : text || null }).catch(() => ({ ok: false as const, error: c.error }))
    setPending(false)
    if (!r.ok) return toast.error(r.error || c.error)
    setOpen(false)
    toast.success(c.saved)
    router.refresh()
  }
  return (
    <>
      <Button variant="secondary" size="touch" onClick={show} className="gap-2">
        <Gauge aria-hidden strokeWidth={1.75} className="size-5" />
        {rpe == null ? c.button : c.rated(rpe)}
      </Button>
      <ResponsiveSheet
        open={open}
        onOpenChange={(o) => !pending && setOpen(o)}
        title={c.title}
        description={c.description}
        footer={
          <>
            <Button size="sheet" onClick={() => save()} disabled={pending} aria-busy={pending || undefined}>
              {c.save}
            </Button>
            {rpe != null && (
              <Button size="sheet" variant="outline-pill" onClick={() => save(true)} disabled={pending}>
                {c.clear}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-5 px-4 pb-4 md:px-6">
          <div className="flex flex-col items-center gap-1 py-2 text-center">
            <span className="font-numeric text-[56px] leading-none font-bold tracking-[-0.01em] tabular-nums">{value.toLocaleString("fr-FR")}</span>
            <span className={LABEL}>{anchor || " "}</span>
            <span className="text-[13px] leading-[18px] text-muted-foreground">{c.load(Math.round(minutes * value))}</span>
          </div>
          <label className="flex flex-col gap-2">
            <span className="sr-only">{c.title}</span>
            <input type="range" min={0} max={10} step={0.5} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-foreground" aria-valuetext={`${value} / 10 ${anchor}`} />
            <span aria-hidden className={cn(LABEL, "flex justify-between text-muted-foreground")}>
              <span>0</span>
              <span>5</span>
              <span>10</span>
            </span>
          </label>
          <label className="flex flex-col gap-2">
            <span className={LABEL}>{c.note}</span>
            <textarea className={AREA} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder={c.notePlaceholder} />
          </label>
        </div>
      </ResponsiveSheet>
    </>
  )
}
