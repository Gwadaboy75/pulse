"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Upload as UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { COPY } from "../copy"

/** Photos are downscaled in the browser (long side 2000 px, JPEG 0.85) before upload: a phone photo is 4 to 12 MB as taken. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/webp" || file.size < 1_500_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file
  } catch {
    return file
  }
}

/** "Importer un document": picks a file, posts it to /api/medical/upload, then opens the document (where the extraction lands). */
export function Upload({ variant = "touch" }: { variant?: "touch" | "sheet" }) {
  const router = useRouter()
  const input = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const c = COPY.documents
  const send = async (file: File) => {
    setPending(true)
    try {
      const form = new FormData()
      form.set("file", await shrink(file))
      const res = await fetch("/api/medical/upload", { method: "POST", body: form })
      const body = (await res.json().catch(() => null)) as { ok: boolean; error?: string; data?: { id: string } } | null
      if (!res.ok || !body?.ok || !body.data) return toast.error(body?.error ?? COPY.common.error)
      router.push(`/medical/documents/${body.data.id}`)
    } catch {
      toast.error(COPY.common.error)
    } finally {
      setPending(false)
      if (input.current) input.current.value = ""
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={c.upload}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void send(f)
        }}
      />
      <Button size={variant} variant={variant === "sheet" ? "default" : "secondary"} disabled={pending} aria-busy={pending || undefined} onClick={() => input.current?.click()}>
        <UploadIcon aria-hidden /> {pending ? c.uploading : c.upload}
      </Button>
    </>
  )
}
