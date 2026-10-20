"use client"

import * as React from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ResponsiveSheet } from "@/components/shells/ResponsiveSheet"
import { Button } from "@/components/ui/button"
import { COPY } from "./copy"

/** The module's field styles, as the profile form's (components/profile/ProfileForm.tsx). */
export const FIELD =
  "h-13 w-full min-w-0 rounded-xl bg-field px-4 text-[17px] leading-6 text-foreground outline-none transition-[box-shadow] duration-150 ease-standard placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-foreground/70 aria-invalid:ring-2 aria-invalid:ring-recovery-red-text"
export const AREA = cn(FIELD, "h-auto min-h-24 py-3 leading-6")
export const LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase"
export const HINT = "text-[13px] leading-[18px] text-muted-foreground text-pretty"
export const ERROR = "text-[13px] leading-[18px] font-medium text-recovery-red-text"
export const ROW = "flex min-h-13 items-center justify-between gap-3 py-2"
export const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"

export function Field({ id, label, hint, optional, children, className }: { id: string; label: string; hint?: string; optional?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className={LABEL}>
        {label}
        {optional && <span className="ml-2 font-medium tracking-normal normal-case text-muted-foreground">{COPY.common.optional}</span>}
      </label>
      {children}
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  )
}

/** A native select in the field style: the module needs a few short lists, and a native control works on every phone. */
export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select {...props} className={cn(FIELD, "appearance-none", className)}>
      {children}
    </select>
  )
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * A sheet around a form: Save runs `submit`, shows its error under the form or closes on success (toast + refresh is
 * the caller's). `onSubmit` returns the action's result.
 */
export function FormSheet<T>({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  onSaved,
  saveLabel = COPY.common.save,
  destructive,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  onSubmit: () => Promise<Result<T>>
  onSaved?: (data: T) => void
  saveLabel?: string
  /** A second, red action under Save (delete). */
  destructive?: { label: string; confirm: string; run: () => Promise<Result<unknown>> }
  children: React.ReactNode
}) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const save = async () => {
    setPending(true)
    setError(null)
    const r = await onSubmit().catch(() => ({ ok: false as const, error: COPY.common.error }))
    setPending(false)
    if (!r.ok) return setError(r.error)
    onOpenChange(false)
    onSaved?.(r.data)
  }
  const destroy = async () => {
    if (!destructive || !window.confirm(destructive.confirm)) return
    setPending(true)
    const r = await destructive.run().catch(() => ({ ok: false as const, error: COPY.common.error }))
    setPending(false)
    if (!r.ok) return setError(r.error)
    onOpenChange(false)
    toast.success(destructive.label)
  }
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={title}
      description={description}
      size="tall"
      footer={
        <>
          {error && (
            <p role="alert" className={ERROR}>
              {error}
            </p>
          )}
          <Button size="sheet" onClick={save} disabled={pending} aria-live="polite">
            {pending ? COPY.common.saving : saveLabel}
          </Button>
          {destructive && (
            <Button variant="outline-pill" size="sheet" className="text-recovery-red-text ring-recovery-red-text/60" onClick={destroy} disabled={pending}>
              {destructive.label}
            </Button>
          )}
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-5 pt-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {children}
      </form>
    </ResponsiveSheet>
  )
}

/** "08:00, 20:00" <-> ["08:00", "20:00"]. */
export const parseTimes = (s: string) => s.split(/[,\s;]+/).map((t) => t.trim()).filter(Boolean)
/** A number input's value as a number or null (an empty field), accepting a comma decimal. */
export const num = (s: string) => {
  const t = s.trim().replace(",", ".")
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
