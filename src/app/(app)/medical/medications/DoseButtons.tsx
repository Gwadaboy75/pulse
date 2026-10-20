"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { logDose } from "@/server/actions/medical"
import { haptic } from "@/lib/haptics"
import { Button } from "@/components/ui/button"
import { COPY } from "../copy"

/** "Prendre" and "Sauter" for one medication: logs a dose now and refreshes. `done`: today's doses are all logged. */
export function DoseButtons({ medicationId, compact = false, done = false }: { medicationId: number; compact?: boolean; done?: boolean }) {
  const router = useRouter()
  const [pending, setPending] = React.useState<"taken" | "skipped" | null>(null)
  const run = async (status: "taken" | "skipped") => {
    setPending(status)
    const r = await logDose({ medicationId, status }).catch(() => ({ ok: false as const, error: COPY.common.error }))
    setPending(null)
    if (!r.ok) return toast.error(r.error)
    haptic()
    toast.success(status === "taken" ? COPY.medications.taken : COPY.medications.skipped)
    router.refresh()
  }
  return (
    <div className={cn("flex shrink-0 gap-1.5", compact && "gap-1")}>
      <Button type="button" size={compact ? "icon-touch" : "touch"} variant={done ? "secondary" : "default"} aria-label={COPY.medications.take} disabled={pending !== null} onClick={() => run("taken")} className={cn(compact && "size-10")}>
        <Check aria-hidden strokeWidth={2.25} />
        {!compact && COPY.medications.take}
      </Button>
      <Button type="button" size={compact ? "icon-touch" : "touch"} variant="secondary" aria-label={COPY.medications.skip} disabled={pending !== null} onClick={() => run("skipped")} className={cn(compact && "size-10")}>
        <X aria-hidden strokeWidth={2.25} />
        {!compact && COPY.medications.skip}
      </Button>
    </div>
  )
}
