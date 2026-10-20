import Link from "next/link"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getDocument } from "@/server/queries/medical"
import { CAPTION } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { SectionShell } from "@/components/shells/SectionShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { COPY } from "../../copy"
import { frDay, frValue } from "../../dates"
import { DocumentActions } from "./DocumentActions"
import { ReviewForm } from "./ReviewForm"

const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"

/**
 * One document `/medical/documents/[id]`: the file, its details, and, while it awaits review, what the model read
 * as an editable form. Once confirmed, the results and medications it produced, with links.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  const ctx = await userCtx()
  const vm = await getDocument(ctx, id)
  if (!vm) notFound()
  const c = COPY.documents
  const reviewing = vm.status === "review" || vm.status === "failed" || vm.status === "uploaded" || vm.status === "extracting"
  const image = vm.mime.startsWith("image/")
  return (
    <DetailShell
      title={vm.title}
      backHref="/medical/documents"
      action={<DocumentActions doc={vm} />}
      primary={
        <div className="flex flex-col gap-4">
          <SectionShell variant="card" level={2} title={c.details}>
            <div className="flex items-start gap-3">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element -- the person's own file, served by /documents/[id]
                <img src={vm.url} alt="" className="size-24 shrink-0 rounded-xl object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className={BODY}>
                  {COPY.kinds[vm.kind]}
                  {vm.day && ` · ${frDay(vm.day)}`}
                  {vm.practitioner && ` · ${vm.practitioner}`}
                </p>
                <p className={cn(CAPTION, "mt-1")}>
                  {Math.round(vm.bytes / 1024)} ko · {COPY.status[vm.status]}
                </p>
                {vm.notes && <p className={cn(BODY, "mt-2 whitespace-pre-wrap")}>{vm.notes}</p>}
              </div>
            </div>
            <div className="mt-4">
              <Button asChild variant="secondary" size="touch" className="w-full">
                <a href={vm.url} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden /> {c.open}
                </a>
              </Button>
            </div>
          </SectionShell>

          {reviewing ? (
            <ReviewForm doc={vm} />
          ) : (
            <>
              {vm.labs.length > 0 && (
                <SectionShell variant="card" level={2} title={c.labsFound}>
                  <ul className="divide-y divide-border">
                    {vm.labs.map((l) => (
                      <li key={l.id} className="flex min-h-12 items-center gap-3 py-2">
                        <Link href={`/medical/labs/${encodeURIComponent(l.analyte)}`} className="min-w-0 flex-1 truncate text-[15px] leading-[22px]">
                          {l.label}
                        </Link>
                        <span className="shrink-0 font-numeric text-[15px] tabular-nums">{frValue(l.value, l.valueText, l.unit)}</span>
                        {l.flag && l.flag !== "normal" && <Badge variant="destructive">{COPY.flags[l.flag]}</Badge>}
                      </li>
                    ))}
                  </ul>
                </SectionShell>
              )}
              {vm.medications.length > 0 && (
                <SectionShell variant="card" level={2} title={c.medicationsFound} href="/medical/medications">
                  <ul className="divide-y divide-border">
                    {vm.medications.map((m) => (
                      <li key={m.id} className="flex min-h-12 items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-[15px] leading-[22px]">
                          {m.name}
                          {m.dose && <span className="text-foreground-secondary"> · {m.dose}</span>}
                        </span>
                        {!m.active && <Badge variant="secondary">{COPY.medications.past}</Badge>}
                      </li>
                    ))}
                  </ul>
                </SectionShell>
              )}
              {typeof (vm.extraction as { summary?: unknown } | null)?.summary === "string" && (vm.extraction as { summary: string }).summary && (
                <SectionShell variant="card" level={2} title={c.summary}>
                  <p className={BODY}>{(vm.extraction as { summary: string }).summary}</p>
                </SectionShell>
              )}
            </>
          )}
        </div>
      }
    />
  )
}
