import { CAPTION, LABEL } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { SectionShell } from "@/components/shells/SectionShell"
import { Skeleton, SkeletonText } from "@/components/ui/skeleton"
import { COPY } from "../../_lib/formulas.copy"

export default function Loading() {
  const c = COPY.energy
  return (
    <DetailShell
      loading
      title={c.title}
      subtitle={c.subtitle}
      backHref="/health"
      hero={
        <div aria-hidden className="flex flex-col items-center gap-2 py-4 text-center">
          <SkeletonText className="w-[5ch] font-numeric text-[64px] leading-none font-bold md:text-[72px]" />
          <span className={LABEL}>{c.rmr}</span>
          <SkeletonText className={`${CAPTION} w-40`} />
        </div>
      }
      summary={
        <SectionShell variant="card" title={c.inputs}>
          <Skeleton className="h-48 w-full" />
        </SectionShell>
      }
      primary={
        <SectionShell variant="card" title={c.tdee}>
          <Skeleton className="h-36 w-full" />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="cmp" variant="card" title={c.comparison} className="xl:col-span-2">
          <Skeleton className="h-64 w-full" />
        </SectionShell>,
      ]}
    />
  )
}
