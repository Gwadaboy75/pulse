import Link from "next/link"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getLabTrend } from "@/server/queries/medical"
import { BiomarkerChart } from "@/components/charts/BiomarkerChart"
import { CAPTION } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { SectionShell } from "@/components/shells/SectionShell"
import { Badge } from "@/components/ui/badge"
import { COPY } from "../../copy"
import { frDay, frValue } from "../../dates"
import { LabSheet } from "../LabSheet"
import { DeleteResultButton } from "./DeleteResultButton"

const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"

/** One analyte `/medical/labs/[analyte]`: its chart against the latest range, and every result with its document. */
export default async function AnalytePage({ params }: { params: Promise<{ analyte: string }> }) {
  await connection()
  const { analyte } = await params
  const ctx = await userCtx()
  const vm = await getLabTrend(ctx, decodeURIComponent(analyte))
  if (!vm) notFound()
  const c = COPY.labs
  const latest = vm.points.at(-1)!
  const range = vm.range ? [vm.range.low !== null ? `${vm.range.low}` : "", vm.range.high !== null ? `${vm.range.high}` : ""].join(" – ") : null
  const numeric = vm.points.filter((p) => p.value !== null).length
  return (
    <DetailShell
      title={vm.label}
      backHref="/medical/labs"
      action={<LabSheet label={vm.label} analyte={vm.analyte} unit={vm.unit} />}
      primary={
        <div className="flex flex-col gap-4">
          <SectionShell variant="card" level={2} title={c.latest}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-numeric text-4xl leading-10 font-bold tracking-[-0.01em] tabular-nums">{frValue(latest.value, latest.valueText, latest.unit)}</p>
              {latest.flag && <Badge variant={latest.flag === "normal" ? "secondary" : "destructive"}>{COPY.flags[latest.flag]}</Badge>}
            </div>
            <p className={cn(CAPTION, "mt-1")}>
              {frDay(latest.day)}
              {latest.labName && ` · ${latest.labName}`}
            </p>
            <p className={cn(BODY, "mt-2")}>
              {c.range}: {range ? `${range}${vm.unit ? ` ${vm.unit}` : ""}` : (latest.refText ?? c.noRange)}
            </p>
            {numeric >= 2 && (
              <div className="mt-4">
                <BiomarkerChart points={vm.points} range={vm.range} unit={vm.unit} summary={`${vm.label}: ${numeric} résultats`} />
              </div>
            )}
          </SectionShell>
          <SectionShell variant="card" level={2} title={c.history}>
            <ul className="divide-y divide-border">
              {[...vm.points].reverse().map((p) => (
                <li key={p.id} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-[22px]">{frDay(p.day)}</span>
                    <span className={cn(CAPTION, "block truncate")}>
                      {p.refLow !== null || p.refHigh !== null ? `${p.refLow ?? ""} – ${p.refHigh ?? ""}` : (p.refText ?? "")}
                      {p.labName && ` · ${p.labName}`}
                      {p.documentId && (
                        <>
                          {" · "}
                          <Link href={`/medical/documents/${p.documentId}`} className="underline underline-offset-2">
                            document
                          </Link>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 font-numeric text-[15px] tabular-nums">{frValue(p.value, p.valueText, p.unit)}</span>
                  {p.flag && p.flag !== "normal" && <Badge variant="destructive">{COPY.flags[p.flag]}</Badge>}
                  <DeleteResultButton id={p.id} last={vm.points.length === 1} />
                </li>
              ))}
            </ul>
          </SectionShell>
        </div>
      }
    />
  )
}
