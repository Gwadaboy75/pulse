import Link from "next/link"
import { connection } from "next/server"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getBloodAge } from "@/server/queries/medical"
import type { BloodAgeVM } from "@/server/queries/types"
import { CAPTION, LABEL, TEXT_LINK, ValueUnit } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { EmptyState } from "@/components/shells/EmptyState"
import { MetricState } from "@/components/shells/MetricState"
import { SectionShell } from "@/components/shells/SectionShell"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { COPY as FCOPY, PHENO_VARIANT_LABEL } from "../../_lib/formulas.copy"
import { COPY } from "../copy"
import { frDay } from "../dates"

export const metadata = { title: COPY.bloodAge.title }

const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"
const VALUE = "font-numeric text-[15px] leading-[22px] tabular-nums"
const fr1 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })
const fr3 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 })
const skeleton = <Skeleton className="h-16 w-full" />

function Hero({ vm }: { vm: BloodAgeVM }) {
  const c = COPY.bloodAge
  const missing = vm.markers.filter((m) => !m.converted).length
  return (
    <MetricState metric={vm.result} skeleton={skeleton} renderReason={() => <EmptyState body={vm.markers.some((m) => m.result) ? c.incomplete(missing) : c.empty} />}>
      {(r, meta) => (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <ValueUnit value={fr1(r.phenoAge)} unit={c.years} className="font-numeric text-[64px] leading-none font-bold tracking-[-0.01em] md:text-[72px]" />
          <p className={LABEL}>{c.result}</p>
          <p className={BODY}>
            {c.delta(r.delta)} · {c.chronological(vm.age)}
          </p>
          {meta.provisional && <p className={cn(CAPTION, "text-warning-text")}>{c.stale}</p>}
        </div>
      )}
    </MetricState>
  )
}

/** Âge sanguin `/medical/bloodage` (docs/formulas.md): PhenoAge from the file's latest results, every conversion shown. */
export default async function BloodAgePage() {
  await connection()
  const vm = await getBloodAge(await userCtx())
  const c = COPY.bloodAge
  const r = vm.result.value
  return (
    <DetailShell
      title={c.title}
      subtitle={c.subtitle}
      backHref="/medical"
      hero={<Hero vm={vm} />}
      summary={
        <SectionShell variant="card" title={c.variant}>
          <div className="space-y-2">
            <p className="text-[15px] leading-[22px] font-semibold">{PHENO_VARIANT_LABEL[vm.variant].label}</p>
            <p className={BODY}>{PHENO_VARIANT_LABEL[vm.variant].hint}</p>
            {r && (
              <dl className="divide-y divide-border">
                <div className="flex min-h-12 items-center justify-between gap-3 py-2">
                  <dt className="min-w-0">
                    <span className="block text-[15px] leading-[22px]">{c.deltaLabel}</span>
                    <span className={cn(CAPTION, "block text-pretty")}>{c.deltaHint}</span>
                  </dt>
                  <dd className={cn(VALUE, "shrink-0")}>{r.delta > 0 ? `+${fr1(r.delta)}` : fr1(r.delta)}</dd>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-3 py-2">
                  <dt className="text-[15px] leading-[22px]">{c.mortality}</dt>
                  <dd className={cn(VALUE, "shrink-0")}>{(100 * r.mortality10y).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</dd>
                </div>
              </dl>
            )}
            <Link href="/settings?s=calc" className={TEXT_LINK}>
              {FCOPY.formulas.change}
            </Link>
          </div>
        </SectionShell>
      }
      primary={
        <SectionShell variant="card" title={c.markers}>
          <p className={cn(BODY, "mb-2")}>{c.markersIntro}</p>
          {vm.drawDay && <p className={cn(CAPTION, "mb-2")}>{c.drawDay(frDay(vm.drawDay))}</p>}
          <ul className="divide-y divide-border">
            {vm.markers.map((m) => (
              <li key={m.marker} className="space-y-0.5 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] leading-[22px]">{c.marker[m.marker]}</span>
                    {m.result && (
                      <span className={cn(CAPTION, "block truncate")}>
                        {m.result.label} · {frDay(m.result.day)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    {m.converted ? (
                      <>
                        <span className={VALUE}>
                          {fr3(m.converted.value)} {m.unit}
                        </span>
                        {m.converted.from && (
                          <span className={cn(CAPTION, "tabular-nums")}>
                            {c.printed} : {fr3(m.converted.from.value)} {m.converted.from.unit}
                          </span>
                        )}
                      </>
                    ) : (
                      <Badge variant="destructive">{c.missing}</Badge>
                    )}
                  </span>
                </div>
                {m.note && <p className={cn(CAPTION, "text-pretty")}>{m.note}</p>}
              </li>
            ))}
          </ul>
        </SectionShell>
      }
      secondary={[
        <SectionShell key="ask" variant="card" title={c.ask}>
          <p className={BODY}>{c.askList}</p>
        </SectionShell>,
        <SectionShell key="notes" variant="card" title={c.notes}>
          <ul className="space-y-1.5">
            {vm.notes.map((n) => (
              <li key={n} className={cn(CAPTION, "text-pretty")}>
                {n}
              </li>
            ))}
            <li className={cn(CAPTION, "text-pretty")}>{c.sensitivity(fr1(vm.crpTenfoldYears))}</li>
            <li className={cn(CAPTION, "text-pretty")}>{c.pulseAgeNote}</li>
          </ul>
          <Link href="/more/formulas" className={cn(TEXT_LINK, "mt-3")}>
            {c.formulas}
          </Link>
        </SectionShell>,
      ]}
      footer={<p className={cn(CAPTION, "text-pretty")}>{c.disclaimer}</p>}
    />
  )
}
