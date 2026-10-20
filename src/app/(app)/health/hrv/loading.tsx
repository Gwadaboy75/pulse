import { CAPTION, LABEL } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { SectionShell } from "@/components/shells/SectionShell"
import { Skeleton, SkeletonText } from "@/components/ui/skeleton"
import { COPY } from "../../_lib/formulas.copy"

export default function Loading() {
  const c = COPY.hrv
  return (
    <DetailShell
      loading
      title={c.title}
      subtitle={c.subtitle}
      backHref="/health"
      hero={
        <div aria-hidden className="flex flex-col items-center gap-2 py-4 text-center">
          <SkeletonText className="w-[4ch] font-numeric text-[64px] leading-none font-bold md:text-[72px]" />
          <span className={LABEL}>{c.latest}</span>
          <SkeletonText className={`${CAPTION} w-32`} />
        </div>
      }
      summary={
        <SectionShell variant="card" title={c.reference}>
          <Skeleton className="h-64 w-full" />
        </SectionShell>
      }
      primary={
        <SectionShell variant="card" title={c.chart}>
          <Skeleton className="h-[220px] w-full" />
        </SectionShell>
      }
    />
  )
}
