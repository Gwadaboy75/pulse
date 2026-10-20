import { connection } from "next/server"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getMedications } from "@/server/queries/medical"
import type { MedicationVM } from "@/server/queries/types"
import { CAPTION } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { EmptyState } from "@/components/shells/EmptyState"
import { SectionShell } from "@/components/shells/SectionShell"
import { COPY, WEEKDAYS } from "../copy"
import { frClock, frDay } from "../dates"
import { DoseButtons } from "./DoseButtons"
import { ActiveToggle, MedicationSheet } from "./MedicationSheet"

export const metadata = { title: COPY.medications.title }

const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"

function scheduleText(m: MedicationVM) {
  const s = m.schedule
  if (!s || s.prn) return COPY.medications.asNeeded
  if (!s.times.length) return COPY.medications.noSchedule
  const days = s.weekdays?.length ? ` (${s.weekdays.map((d) => WEEKDAYS[d]).join(", ")})` : ""
  return `${s.times.join(", ")}${days}`
}

function MedicationCard({ m, timeZone }: { m: MedicationVM; timeZone: string }) {
  const c = COPY.medications
  const dates = [m.startedOn && c.since(frDay(m.startedOn)), m.endedOn && c.until(frDay(m.endedOn))].filter(Boolean).join(" · ")
  return (
    <SectionShell variant="card" level={3} title={m.name} action={<MedicationSheet medication={m} trigger="edit" />}>
      <p className={BODY}>
        {[m.dose, m.form, m.route].filter(Boolean).join(" · ") || "—"}
        {m.reason && <span className="text-muted-foreground"> · {m.reason}</span>}
      </p>
      <p className={cn(CAPTION, "mt-1")}>
        {scheduleText(m)}
        {dates && ` · ${dates}`}
        {m.practitioner && ` · ${m.practitioner}`}
      </p>
      {m.active && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className={CAPTION}>
            {m.today.events.length
              ? m.today.events.map((e) => `${e.status === "taken" ? c.taken : c.skipped} ${frClock(e.ts, timeZone)}`).join(" · ")
              : m.lastTakenAt
                ? c.lastTaken(frDay(new Date(m.lastTakenAt * 1000).toISOString().slice(0, 10), { day: "numeric", month: "short" }))
                : ""}
          </p>
          <DoseButtons medicationId={m.id} done={m.today.due.length > 0 && m.today.taken >= m.today.due.length} />
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <ActiveToggle medication={m} />
      </div>
    </SectionShell>
  )
}

/** Traitements `/medical/medications`: the active ones with today's doses, then the past ones. */
export default async function MedicationsPage() {
  await connection()
  const ctx = await userCtx()
  const meds = await getMedications(ctx)
  const active = meds.filter((m) => m.active)
  const past = meds.filter((m) => !m.active)
  const c = COPY.medications
  return (
    <DetailShell
      title={c.title}
      backHref="/medical"
      action={<MedicationSheet />}
      primary={
        meds.length === 0 ? (
          <EmptyState body={c.empty} />
        ) : (
          <div className="flex flex-col gap-6">
            {active.length > 0 && (
              <SectionShell variant="section" level={2} title={c.active}>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {active.map((m) => (
                    <MedicationCard key={m.id} m={m} timeZone={ctx.timeZone} />
                  ))}
                </div>
              </SectionShell>
            )}
            {past.length > 0 && (
              <SectionShell variant="section" level={2} title={c.past}>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {past.map((m) => (
                    <MedicationCard key={m.id} m={m} timeZone={ctx.timeZone} />
                  ))}
                </div>
              </SectionShell>
            )}
          </div>
        )
      }
    />
  )
}
