import Link from "next/link"
import { connection } from "next/server"
import { ChevronRight, FileImage, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getDocuments } from "@/server/queries/medical"
import { CAPTION } from "@/components/metrics/primitives"
import { CARD_LINK } from "@/components/shells/SectionShell"
import { DetailShell } from "@/components/shells/DetailShell"
import { EmptyState } from "@/components/shells/EmptyState"
import { Badge } from "@/components/ui/badge"
import { COPY } from "../copy"
import { frDay } from "../dates"
import { Upload } from "./Upload"

export const metadata = { title: COPY.documents.title }

/** Documents `/medical/documents`: every file, newest first, the ones awaiting review marked. */
export default async function DocumentsPage() {
  await connection()
  const ctx = await userCtx()
  const docs = await getDocuments(ctx)
  const c = COPY.documents
  return (
    <DetailShell
      title={c.title}
      backHref="/medical"
      action={<Upload />}
      primary={
        docs.length === 0 ? (
          <EmptyState icon={FileText} body={`${c.empty} ${c.uploadHint}`} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className={CAPTION}>{c.uploadHint}</p>
            <ul className="grid gap-2 xl:grid-cols-2">
              {docs.map((d) => {
                const Icon = d.mime === "application/pdf" ? FileText : FileImage
                const pending = d.status === "review" || d.status === "failed" || d.status === "extracting" || d.status === "uploaded"
                return (
                  <li key={d.id} className="min-w-0">
                    <Link href={`/medical/documents/${d.id}`} className={cn(CARD_LINK, "flex min-h-16 items-center gap-3 px-4 py-3")}>
                      <Icon aria-hidden className="size-[22px] shrink-0 text-foreground-secondary" strokeWidth={1.5} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] leading-[22px] font-semibold">{d.title}</span>
                        <span className={cn(CAPTION, "block truncate")}>
                          {COPY.kinds[d.kind]}
                          {d.day && ` · ${frDay(d.day)}`}
                          {d.labCount > 0 && ` · ${c.linked.labs(d.labCount)}`}
                          {d.medicationCount > 0 && ` · ${c.linked.medications(d.medicationCount)}`}
                        </span>
                      </span>
                      {pending && <Badge variant={d.status === "failed" ? "destructive" : "secondary"}>{COPY.status[d.status]}</Badge>}
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      }
    />
  )
}
