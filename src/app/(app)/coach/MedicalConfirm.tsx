"use client"

import { Check, X } from "lucide-react"
import type { MedicalWriteToolName } from "@/lib/medical"
import { cn } from "@/lib/utils"
import type { MedicalWriteOutput } from "@/server/coach/medicalTools"
import { Button } from "@/components/ui/button"
import { CARD_MATERIAL } from "@/components/ui/card"
import type { LogPart } from "./LogConfirm"

type Input = Record<string, unknown>

/** What the card shows for each medical write tool, from the call's input. */
export function medicalPreview(name: MedicalWriteToolName, i: Input): { title: string; detail: string; when: string } {
  if (name === "add_medication") {
    const times = Array.isArray(i.times) && i.times.length ? i.times.join(", ") : i.prn ? "as needed" : ""
    return { title: String(i.name ?? "Medication"), detail: [i.dose, times, i.reason].filter(Boolean).join(" · ") || "No details", when: i.startedOn ? `from ${i.startedOn}` : "from today" }
  }
  return { title: i.status === "skipped" ? "Dose skipped" : "Dose taken", detail: `Medication #${String(i.medicationId ?? "?")}`, when: typeof i.at === "string" ? i.at.replace("T", " at ") : "Now" }
}

function Status({ tone, children }: { tone: "done" | "off" | "live"; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[13px] leading-[18px] text-muted-foreground">
      {tone === "done" ? <Check aria-hidden className="size-3.5 text-recovery-green" strokeWidth={2.25} /> : tone === "off" ? <X aria-hidden className="size-3.5" strokeWidth={2} /> : <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-coach motion-reduce:animate-none" />}
      {children}
    </p>
  )
}

/** A medical write tool call in the chat: a card to confirm while it waits, then what happened to it (as LogConfirm). */
export function MedicalConfirm({ name, part, onAnswer }: { name: MedicalWriteToolName; part: LogPart; onAnswer?: (id: string, approved: boolean) => void }) {
  if (part.state === "input-streaming" || part.state === "input-available") return <Status tone="live">Preparing the entry…</Status>
  const p = medicalPreview(name, (part.input ?? {}) as Input)
  const line = `${p.title} · ${p.detail}`
  if (part.state === "output-available") {
    const out = part.output as MedicalWriteOutput
    if (!out.done) return <Status tone="off">Not saved: {out.error}</Status>
    return <Status tone="done">Saved {out.detail}</Status>
  }
  if (part.state === "output-error") return <Status tone="off">Couldn’t save {line}.</Status>
  if (part.state === "output-denied" || (part.state === "approval-responded" && !part.approval?.approved)) return <Status tone="off">Not saved: {line}</Status>
  if (part.state === "approval-responded") return <Status tone="live">Saving {line}…</Status>
  if (part.state !== "approval-requested" || !part.approval) return null
  const { id } = part.approval
  return (
    <div role="group" aria-label={`Save ${p.title}?`} className={cn(CARD_MATERIAL, "px-4 py-3")}>
      <p className="text-[12px] leading-4 font-semibold text-foreground-secondary">{name === "add_medication" ? "Add this medication?" : "Log this dose?"}</p>
      <p className="mt-1 text-[15px] leading-6 font-semibold text-foreground">{p.title}</p>
      <p className="text-[14px] leading-5 text-foreground-secondary">{p.detail}</p>
      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{p.when}</p>
      {onAnswer ? (
        <div className="mt-3 flex gap-2">
          <Button type="button" onClick={() => onAnswer(id, true)} className="h-9 rounded-full px-4 text-[13px] font-semibold pointer-coarse:h-10">
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => onAnswer(id, false)} className="h-9 rounded-full px-4 text-[13px] font-semibold pointer-coarse:h-10">
            Don’t save
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[13px] leading-[18px] text-muted-foreground">Not saved.</p>
      )}
    </div>
  )
}
