import Link from "next/link"
import { connection } from "next/server"
import { CalendarClock, FileText, FlaskConical, Hourglass, Pill } from "lucide-react"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getMedicalHub } from "@/server/queries/medical"
import { CAPTION } from "@/components/metrics/primitives"
import { LinkList } from "@/components/shells/LinkList"
import { PageShell } from "@/components/shells/PageShell"
import { SectionShell } from "@/components/shells/SectionShell"
import { Badge } from "@/components/ui/badge"
import { COPY } from "./copy"
import { frDateTime, frDay, frValue } from "./dates"
import { DoseButtons } from "./medications/DoseButtons"

export const metadata = { title: COPY.hub.title }

const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"
const ROW = "flex min-h-12 items-center justify-between gap-3 py-2"

/** Médical `/medical`: today's doses, the next appointment, results out of range, recent documents, and the sections. */
export default async function MedicalPage() {
  await connection()
  const ctx = await userCtx()
  const vm = await getMedicalHub(ctx)
  const c = COPY.hub
  const sections = [
    { icon: FlaskConical, label: c.sections.labs, href: "/medical/labs", aside: vm.counts.analytes ? String(vm.counts.analytes) : undefined },
    { icon: Pill, label: c.sections.medications, href: "/medical/medications", aside: vm.counts.medications ? String(vm.counts.medications) : undefined },
    { icon: FileText, label: c.sections.documents, href: "/medical/documents", aside: vm.pendingReview ? c.pendingReview(vm.pendingReview) : vm.counts.documents ? String(vm.counts.documents) : undefined },
    { icon: CalendarClock, label: c.sections.appointments, href: "/medical/appointments", aside: vm.counts.appointments ? String(vm.counts.appointments) : undefined },
    { icon: Hourglass, label: COPY.bloodAge.hubLabel, href: "/medical/bloodage" },
  ]
  return (
    <PageShell title={c.title}>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:gap-4">
        <SectionShell variant="card" level={2} title={c.medications} href="/medical/medications" className="xl:col-span-2">
          {vm.medications.length === 0 ? (
            <p className={BODY}>{c.noMedications}</p>
          ) : (
            <ul className="divide-y divide-border">
              {vm.medications.map((m) => (
                <li key={m.id} className={ROW}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] leading-[22px] font-semibold">
                      {m.name}
                      {m.dose && <span className="font-normal text-foreground-secondary"> · {m.dose}</span>}
                    </p>
                    <p className={cn(CAPTION, "truncate")}>
                      {m.schedule?.prn ? COPY.medications.asNeeded : m.today.due.length ? m.today.due.map((t) => COPY.medications.dueAt(t)).join(", ") : COPY.medications.noSchedule}
                      {m.today.taken > 0 && ` · ${COPY.medications.taken} ${m.today.taken}/${Math.max(m.today.due.length, m.today.taken)}`}
                    </p>
                  </div>
                  <DoseButtons medicationId={m.id} compact done={m.today.due.length > 0 && m.today.taken >= m.today.due.length} />
                </li>
              ))}
            </ul>
          )}
        </SectionShell>

        <SectionShell variant="card" level={2} title={c.nextAppointment} href="/medical/appointments">
          {vm.nextAppointment ? (
            <div>
              <p className="text-[15px] leading-[22px] font-semibold">{vm.nextAppointment.title}</p>
              <p className={BODY}>
                {frDateTime(vm.nextAppointment.startsAt, vm.timeZone)}
                {vm.nextAppointment.practitioner && ` · ${vm.nextAppointment.practitioner}`}
              </p>
              {vm.nextAppointment.location && <p className={CAPTION}>{vm.nextAppointment.location}</p>}
            </div>
          ) : (
            <p className={BODY}>{c.noAppointment}</p>
          )}
        </SectionShell>

        <SectionShell variant="card" level={2} title={c.outOfRange} href="/medical/labs">
          {vm.counts.analytes === 0 ? (
            <p className={BODY}>{c.noLabs}</p>
          ) : vm.outOfRange.length === 0 ? (
            <p className={BODY}>{c.allInRange}</p>
          ) : (
            <ul className="divide-y divide-border">
              {vm.outOfRange.slice(0, 6).map((l) => (
                <li key={l.id} className={ROW}>
                  <Link href={`/medical/labs/${encodeURIComponent(l.analyte)}`} className="min-w-0 flex-1">
                    <p className="truncate text-[15px] leading-[22px] font-semibold">{l.label}</p>
                    <p className={CAPTION}>{frDay(l.day)}</p>
                  </Link>
                  <span className="shrink-0 font-numeric text-[15px] tabular-nums">{frValue(l.value, l.valueText, l.unit)}</span>
                  {l.flag && <Badge variant={l.flag === "normal" ? "secondary" : "destructive"}>{COPY.flags[l.flag]}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </SectionShell>

        <SectionShell variant="card" level={2} title={c.documents} href="/medical/documents" className="xl:col-span-2">
          {vm.recentDocuments.length === 0 ? (
            <p className={BODY}>{c.noDocuments}</p>
          ) : (
            <ul className="divide-y divide-border">
              {vm.recentDocuments.map((d) => (
                <li key={d.id}>
                  <Link href={`/medical/documents/${d.id}`} className={ROW}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] leading-[22px] font-semibold">{d.title}</p>
                      <p className={CAPTION}>
                        {COPY.kinds[d.kind]}
                        {d.day && ` · ${frDay(d.day)}`}
                      </p>
                    </div>
                    {(d.status === "review" || d.status === "failed" || d.status === "extracting") && <Badge variant={d.status === "failed" ? "destructive" : "secondary"}>{COPY.status[d.status]}</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionShell>

        <div className="xl:col-span-2">
          <LinkList title={c.title} rows={sections} columns={2} />
        </div>
        <p className={cn(CAPTION, "xl:col-span-2")}>{c.disclaimer}</p>
      </div>
    </PageShell>
  )
}
