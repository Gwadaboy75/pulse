"use client"

import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { deleteLabResult } from "@/server/actions/medical"
import { Button } from "@/components/ui/button"
import { COPY } from "../../copy"

/** Removes one result; the last one of an analyte sends the person back to the list. */
export function DeleteResultButton({ id, last }: { id: number; last: boolean }) {
  const router = useRouter()
  const run = async () => {
    if (!window.confirm(COPY.labs.delete + " ?")) return
    const r = await deleteLabResult(id).catch(() => ({ ok: false as const, error: COPY.common.error }))
    if (!r.ok) return toast.error(r.error)
    if (last) router.replace("/medical/labs")
    else router.refresh()
  }
  return (
    <Button size="icon-touch" variant="ghost" aria-label={COPY.labs.delete} className="size-9 text-muted-foreground" onClick={run}>
      <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
    </Button>
  )
}
