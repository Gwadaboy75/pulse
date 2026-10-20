import Link from "next/link"
import { connection } from "next/server"
import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getAnalytes, getClinical } from "@/server/queries/medical"
import { CAPTION } from "@/components/metrics/primitives"
import { CARD_LINK, SectionShell } from "@/components/shells/SectionShell"
import { DetailShell } from "@/components/shells/DetailShell"
import { EmptyState } from "@/components/shells/EmptyState"
import { Badge } from "@/components/ui/badge"
import { COPY } from "../copy"
import { frDay, frValue } from "../dates"
import { LabSheet } from "./LabSheet"

export const metadata = { title: COPY.labs.title }

/** Analyses `/medical/labs`: one row per analyte with its latest result, flag and move; each opens its history. */
export default async function LabsPage() {
  await connection()
  const ctx = await userCtx()
  const [analytes, clinical] = await Promise.all([getAnalytes(ctx), getClinical(ctx)])
  const c = COPY.labs
  return (
    <DetailShell
      title={c.title}
      backHref="/medical"
      action={<LabSheet />}
      primary={
        analytes.length === 0 ? (
          <EmptyState body={c.empty} />
        ) : (
          <ul className="grid gap-2 xl:grid-cols-2">
            {analytes.map((a) => (
              <li key={a.analyte} className="min-w-0">
                <Link href={`/medical/labs/${encodeURIComponent(a.analyte)}`} className={cn(CARD_LINK, "flex min-h-16 items-center gap-3 px-4 py-3")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] leading-[22px] font-semibold">{a.label}</span>
                    <span className={cn(CAPTION, "block truncate")}>
                      {frDay(a.latest.day)} · {c.results(a.count)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {a.delta !== null && a.delta !== 0 && (a.delta > 0 ? <TrendingUp aria-hidden className="size-4 text-muted-foreground" /> : <TrendingDown aria-hidden className="size-4 text-muted-foreground" />)}
                    <span className="font-numeric text-[15px] tabular-nums">{frValue(a.latest.value, a.latest.valueText, a.unit)}</span>
                    {a.latest.flag && a.latest.flag !== "normal" && <Badge variant="destructive">{COPY.flags[a.latest.flag]}</Badge>}
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      }
      secondary={[
        <SectionShell key="bloodage" variant="card" level={2} title={COPY.bloodAge.title} href="/medical/bloodage">
          <p className={BODY}>{COPY.bloodAge.subtitle}</p>
        </SectionShell>,
        ...(clinical.length
          ? [
              <SectionShell key="clinical" variant="card" level={2} title={COPY.clinical.title}>
                <p className={cn(BODY, "mb-2")}>{COPY.clinical.intro}</p>
                <ul className="divide-y divide-border">
                  {clinical.map((k) => (
                    <li key={k.id} className="space-y-0.5 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[15px] leading-[22px]">{k.name}</span>
                        <span className="shrink-0 font-numeric text-[15px] tabular-nums">
                          {k.result.value!.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}
                          {k.result.unit ? ` ${k.result.unit}` : ""}
                        </span>
                      </div>
                      <p className={cn(CAPTION, "text-pretty")}>
                        {COPY.clinical.inputs} : {k.inputs.map((i) => `${i.label} ${i.printed} (${frDay(i.day)})`).join(" · ")}
                      </p>
                      {k.result.notes.map((n) => (
                        <p key={n} className={cn(CAPTION, "text-pretty")}>
                          {n}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </SectionShell>,
            ]
          : []),
      ]}
    />
  )
}

const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"
