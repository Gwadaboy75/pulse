import Link from "next/link"
import { cn } from "@/lib/utils"
import type { CalcSettings as Calc } from "@/server/calc"
import { CAPTION, TEXT_LINK } from "@/components/metrics/primitives"
import { SectionShell } from "@/components/shells/SectionShell"
import { ACTIVITY_LABEL, COPY, HRV_METHOD_LABEL, PHENO_VARIANT_LABEL, RMR_LABEL, STRAIN_METHOD_LABEL } from "../_lib/formulas.copy"
import { EditCalcButton } from "./CalcSettingsClient"

const ROW = "flex min-h-13 items-center justify-between gap-3 py-2"
const ROW_LABEL = "text-[15px] leading-[22px]"
const ROW_VALUE = "truncate text-right text-[15px] leading-[22px] text-foreground-secondary"

/** Settings › Calculs (docs/formulas.md): the method in use per block, read-only, with Modifier opening the sheet. */
export function CalcSettings({ calc, profileSex }: { calc: Calc; profileSex: "male" | "female" }) {
  const c = COPY.calc
  const rows: [string, string][] = [
    [c.rows.strain, STRAIN_METHOD_LABEL[calc.strainMethod].label],
    [c.rows.rmr, RMR_LABEL[calc.rmrEquation]],
    [c.rows.activity, ACTIVITY_LABEL[calc.activityLevel].label],
    [c.rows.phenoage, PHENO_VARIANT_LABEL[calc.phenoageVariant].label],
    [c.rows.hrv, `${HRV_METHOD_LABEL[calc.hrvReferenceMethod].label}, ${c.nights(calc.hrvReferenceDays)}`],
  ]
  return (
    <SectionShell variant="card" level={2} id="calc" title={c.title} action={<EditCalcButton defaults={calc} profileSex={profileSex} />}>
      <dl className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className={ROW}>
            <dt className={ROW_LABEL}>{k}</dt>
            <dd className={ROW_VALUE}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className={cn(CAPTION, "mt-2 text-pretty")}>{c.description}</p>
      <Link href="/more/formulas" className={cn(TEXT_LINK, "mt-3")}>
        {c.formulas}
      </Link>
    </SectionShell>
  )
}
