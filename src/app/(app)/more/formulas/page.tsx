import Link from "next/link"
import { connection } from "next/server"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getFormulas } from "@/server/queries/formulas"
import { CAPTION, TEXT_LINK } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { SectionShell } from "@/components/shells/SectionShell"
import { Badge } from "@/components/ui/badge"
import { COPY } from "../../_lib/formulas.copy"

export const metadata = { title: COPY.formulas.title }

const BODY = "max-w-[65ch] text-[15px] leading-[22px] text-pretty text-foreground-secondary"

/** Formules et calculs `/more/formulas` (docs/formulas.md): every method, the one in use marked, with version, domain and sources. */
export default async function FormulasPage() {
  await connection()
  const ctx = await userCtx()
  const vm = getFormulas(ctx)
  const c = COPY.formulas
  return (
    <DetailShell
      title={c.title}
      backHref="/more"
      primary={
        <div className="flex flex-col gap-3">
          <p className={BODY}>{c.intro}</p>
          <Link href="/settings?s=calc" className={TEXT_LINK}>
            {c.change}
          </Link>
        </div>
      }
      secondary={vm.groups.map((g) => (
        <SectionShell key={g.key} variant="card" level={2} title={c.groups[g.key]} className={g.key === "energy" ? "xl:col-span-2" : undefined}>
          <ul className="divide-y divide-border">
            {g.rows.map((f) => (
              <li key={f.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] leading-[22px] font-semibold text-balance">{f.name}</p>
                  <span className="flex shrink-0 items-center gap-2">
                    {f.inUse && <Badge>{c.inUse}</Badge>}
                    <span className={cn(CAPTION, "tabular-nums")}>
                      {c.version} {f.version}
                    </span>
                  </span>
                </div>
                <p className={BODY}>{f.domain}</p>
                {f.notes?.map((n) => (
                  <p key={n} className={cn(CAPTION, "text-pretty")}>
                    {n}
                  </p>
                ))}
                <ul className="flex flex-col gap-0.5">
                  {f.sources.map((s) => (
                    <li key={s.label} className={cn(CAPTION, "text-pretty")}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                          {s.label}
                        </a>
                      ) : (
                        s.label
                      )}
                    </li>
                  ))}
                </ul>
                {f.href && (
                  <Link href={f.href} className={cn(TEXT_LINK, "text-[13px]")}>
                    {c.open}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </SectionShell>
      ))}
    />
  )
}
