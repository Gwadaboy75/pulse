import Link from "next/link"
import { connection } from "next/server"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getEnergy } from "@/server/queries/energy"
import type { EnergyVM } from "@/server/queries/types"
import { CAPTION, LABEL, TEXT_LINK, ValueUnit } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { EmptyState } from "@/components/shells/EmptyState"
import { MetricState } from "@/components/shells/MetricState"
import { SectionShell } from "@/components/shells/SectionShell"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ACTIVITY_LABEL, COPY } from "../../_lib/formulas.copy"
import { frDay } from "../../medical/dates"

export const metadata = { title: COPY.energy.title }

const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"
const ROW = "flex min-h-12 items-center justify-between gap-3 py-2"
const VALUE = "font-numeric text-[15px] leading-[22px] tabular-nums"
const skeleton = <Skeleton className="h-16 w-full" />
const fr = (n: number) => n.toLocaleString("fr-FR")

function Hero({ vm }: { vm: EnergyVM }) {
  const c = COPY.energy
  return (
    <MetricState metric={vm.rmr} skeleton={skeleton} renderReason={() => <EmptyState body={vm.inputs.weight ? c.noHeight : c.noWeight} />}>
      {(r) => (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <ValueUnit value={fr(r.value as number)} unit={c.kcal} className="font-numeric text-[64px] leading-none font-bold tracking-[-0.01em] md:text-[72px]" />
          <p className={LABEL}>{c.rmr}</p>
          <p className={CAPTION}>{c.rmrCaption(vm.equationName)}</p>
        </div>
      )}
    </MetricState>
  )
}

function Inputs({ i }: { i: EnergyVM["inputs"] }) {
  const c = COPY.energy
  const rows: [string, string, string?][] = [
    [c.weight, i.weight ? `${fr(i.weight.value)} kg` : "—", i.weight ? frDay(i.weight.day) : undefined],
    [c.bodyFat, i.bodyFat ? `${fr(i.bodyFat.value)} %` : "—", i.bodyFat ? frDay(i.bodyFat.day) : undefined],
    [c.ffm, i.ffmKg != null ? `${fr(i.ffmKg)} kg` : "—", i.bodyFat ? (i.ffmStale ? c.ffmStale : c.ffmFrom(frDay(i.bodyFat.day))) : undefined],
    [c.height, i.heightCm != null ? `${fr(i.heightCm)} cm` : "—"],
    [c.age, `${i.age} ${c.years}`],
    [c.sex, i.sex === "male" ? c.male : c.female],
  ]
  return (
    <dl className="divide-y divide-border">
      {rows.map(([k, v, cap]) => (
        <div key={k} className={ROW}>
          <dt className="min-w-0">
            <span className="block text-[15px] leading-[22px]">{k}</span>
            {cap && <span className={cn(CAPTION, "block text-pretty")}>{cap}</span>}
          </dt>
          <dd className={cn(VALUE, "shrink-0 text-right")}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Total({ vm }: { vm: EnergyVM }) {
  const c = COPY.energy
  const line = (label: string, m: EnergyVM["tdee"]["pal"]) => (
    <div className={ROW}>
      <dt className="text-[15px] leading-[22px]">{label}</dt>
      <dd className={cn(VALUE, "shrink-0")}>
        <MetricState metric={m} skeleton={<span>…</span>} reasonSize="sm">
          {(r) => <ValueUnit value={fr(r.value as number)} unit={c.kcal} />}
        </MetricState>
      </dd>
    </div>
  )
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-border">
        {line(c.pal, vm.tdee.pal)}
        {line(c.eer, vm.tdee.eer)}
        <div className={ROW}>
          <dt className="min-w-0">
            <span className="block text-[15px] leading-[22px]">{c.wearable}</span>
            <span className={cn(CAPTION, "block text-pretty")}>{c.wearableCaption}</span>
          </dt>
          <dd className={cn(VALUE, "shrink-0 text-right")}>{vm.wearable.mean7 != null ? `${fr(vm.wearable.mean7)} ${c.kcal}` : "—"}</dd>
        </div>
      </dl>
      <p className={CAPTION}>
        {ACTIVITY_LABEL[vm.tdee.level].label} · {ACTIVITY_LABEL[vm.tdee.level].hint}{" "}
        <Link href="/settings?s=calc" className={cn(TEXT_LINK, "inline")}>
          {COPY.formulas.change}
        </Link>
      </p>
    </div>
  )
}

/** Énergie `/health/energy` (docs/formulas.md): the chosen resting rate, its inputs, the total two ways, every equation. */
export default async function EnergyPage() {
  await connection()
  const vm = await getEnergy(await userCtx())
  const c = COPY.energy
  return (
    <DetailShell
      title={c.title}
      subtitle={c.subtitle}
      backHref="/health"
      hero={<Hero vm={vm} />}
      summary={
        <SectionShell variant="card" title={c.inputs}>
          <Inputs i={vm.inputs} />
        </SectionShell>
      }
      primary={
        <SectionShell variant="card" title={c.tdee}>
          <Total vm={vm} />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="cmp" variant="card" title={c.comparison} className="xl:col-span-2">
          <p className={cn(BODY, "mb-2")}>{c.comparisonIntro}</p>
          <ul className="divide-y divide-border">
            {vm.comparison.map((e) => (
              <li key={e.equation} className="space-y-0.5 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[15px] leading-[22px]">{e.name}</span>
                    {e.inUse && <Badge>{COPY.formulas.inUse}</Badge>}
                  </span>
                  <span className={cn(VALUE, "shrink-0", e.value == null && "text-muted-foreground")}>{e.value != null ? `${fr(e.value)} ${c.kcal}` : `${c.missing} : ${e.missing.join(", ")}`}</span>
                </div>
                {e.notes.map((n) => (
                  <p key={n} className={cn(CAPTION, "text-pretty")}>
                    {n}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </SectionShell>,
        <SectionShell key="age" variant="card" title={c.metabolicAge}>
          <MetricState metric={vm.metabolicAge} skeleton={skeleton} reasonSize="sm">
            {(r) => (
              <div className="space-y-1">
                <ValueUnit value={fr(r.value as number)} unit={c.years} className="font-numeric text-4xl leading-10 font-bold tracking-[-0.01em]" />
                <p className={CAPTION}>{c.metabolicAgeHint}</p>
              </div>
            )}
          </MetricState>
        </SectionShell>,
      ]}
      footer={
        <p className={cn(CAPTION, "text-pretty")}>
          {c.disclaimer}{" "}
          <Link href="/more/formulas" className={cn(TEXT_LINK, "inline")}>
            {COPY.calc.formulas}
          </Link>
        </p>
      }
    />
  )
}
