import Link from "next/link"
import { connection } from "next/server"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getHrvPanel } from "@/server/queries/hrv"
import type { HrvVM } from "@/server/queries/types"
import { HrvReferenceChart } from "@/components/charts/HrvReferenceChart"
import { CAPTION, LABEL, StatusChip, TEXT_LINK, ValueUnit } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { EmptyState } from "@/components/shells/EmptyState"
import { MetricState } from "@/components/shells/MetricState"
import { ReasonPlaceholder } from "@/components/metrics/ReasonPlaceholder"
import { SectionShell } from "@/components/shells/SectionShell"
import { Skeleton } from "@/components/ui/skeleton"
import { COPY, HRV_METHOD_LABEL } from "../../_lib/formulas.copy"
import { frDay } from "../../medical/dates"

export const metadata = { title: COPY.hrv.title }

const ROW = "flex min-h-12 items-center justify-between gap-3 py-2"
const VALUE = "font-numeric text-[15px] leading-[22px] tabular-nums"
const fr1 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })
const skeleton = <Skeleton className="h-16 w-full" />

function Hero({ vm }: { vm: HrvVM }) {
  const c = COPY.hrv
  const p = vm.panel.value
  const latest = p?.latest
  if (!latest) {
    const cov = vm.coverage
    return <EmptyState body={cov && cov.have > 0 ? c.notEnough(cov.have, cov.need) : c.noHrv} />
  }
  const chip = vm.position === "in" ? { tone: "optimal" as const, text: c.inBand } : vm.position === "above" ? { tone: "neutral" as const, text: c.above } : vm.position === "below" ? { tone: "warning" as const, text: c.below } : null
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <ValueUnit value={fr1(latest.ms)} unit={c.ms} className="font-numeric text-[64px] leading-none font-bold tracking-[-0.01em] md:text-[72px]" />
      <p className={LABEL}>
        {c.latest} · {frDay(latest.day)}
      </p>
      {chip && <StatusChip tone={chip.tone}>{chip.text}</StatusChip>}
    </div>
  )
}

/** HRV `/health/hrv` (docs/formulas.md): the latest night against the chosen reference, the 7-night trend and its variability. */
export default async function HrvPage() {
  await connection()
  const ctx = await userCtx()
  const vm = await getHrvPanel(ctx)
  const c = COPY.hrv
  const method = HRV_METHOD_LABEL[ctx.calc.hrvReferenceMethod].label
  return (
    <DetailShell
      title={c.title}
      subtitle={c.subtitle}
      backHref="/health"
      hero={<Hero vm={vm} />}
      summary={
        <SectionShell variant="card" title={c.reference}>
          <MetricState metric={vm.panel} skeleton={skeleton} renderReason={(r) => <ReasonPlaceholder reason={r} size="sm" copy={vm.coverage ? c.notEnough(vm.coverage.have, vm.coverage.need) : undefined} />}>
            {(p) => (
              <dl className="divide-y divide-border">
                <div className={ROW}>
                  <dt className="min-w-0">
                    <span className="block text-[15px] leading-[22px]">{c.reference}</span>
                    <span className={cn(CAPTION, "block")}>{c.referenceCaption(p.referenceDays, method)}</span>
                  </dt>
                  <dd className={cn(VALUE, "shrink-0")}>{p.reference ? `${fr1(p.reference.ms)} ${c.ms}` : "—"}</dd>
                </div>
                <div className={ROW}>
                  <dt className="text-[15px] leading-[22px]">{c.band}</dt>
                  <dd className={cn(VALUE, "shrink-0")}>{p.reference ? `${fr1(Math.exp(p.reference.lo))}–${fr1(Math.exp(p.reference.hi))} ${c.ms}` : "—"}</dd>
                </div>
                <div className={ROW}>
                  <dt className="text-[15px] leading-[22px]">{c.z}</dt>
                  <dd className={cn(VALUE, "shrink-0")}>{p.z != null ? (p.z > 0 ? `+${fr1(p.z)}` : fr1(p.z)) : "—"}</dd>
                </div>
                <div className={ROW}>
                  <dt className="min-w-0">
                    <span className="block text-[15px] leading-[22px]">{c.trend}</span>
                    <span className={cn(CAPTION, "block")}>{p.trend ? `${p.trend.valid}/7 ${c.nights.toLowerCase()}` : ""}</span>
                  </dt>
                  <dd className={cn(VALUE, "shrink-0")}>{p.trend ? `${fr1(p.trend.ms)} ${c.ms}` : "—"}</dd>
                </div>
                <div className={ROW}>
                  <dt className="min-w-0">
                    <span className="block text-[15px] leading-[22px]">{c.cv}</span>
                    <span className={cn(CAPTION, "block")}>{c.cvCaption}</span>
                  </dt>
                  <dd className={cn(VALUE, "shrink-0")}>{p.cv7 != null ? `${fr1(p.cv7)} %` : "—"}</dd>
                </div>
                <div className={ROW}>
                  <dt className="text-[15px] leading-[22px]">{c.nights}</dt>
                  <dd className={cn(VALUE, "shrink-0")}>{p.reference ? p.reference.valid : vm.coverage?.have ?? 0}</dd>
                </div>
              </dl>
            )}
          </MetricState>
        </SectionShell>
      }
      primary={
        <SectionShell variant="card" title={c.chart}>
          {vm.points.some((p) => p.ms != null) ? <HrvReferenceChart points={vm.points} summary={c.chart} /> : <EmptyState body={c.noHrv} />}
          <p className={cn(CAPTION, "mt-3 text-pretty")}>{c.chartCaption}</p>
        </SectionShell>
      }
      footer={
        <div className="space-y-2">
          {vm.notes.map((n) => (
            <p key={n} className={cn(CAPTION, "text-pretty")}>
              {n}
            </p>
          ))}
          <p className={cn(CAPTION, "text-pretty")}>
            {c.recoveryNote}{" "}
            <Link href="/settings?s=calc" className={cn(TEXT_LINK, "inline")}>
              {COPY.formulas.change}
            </Link>
          </p>
        </div>
      }
    />
  )
}
