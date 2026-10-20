import { connection } from "next/server"
import { cn } from "@/lib/utils"
import { userCtx } from "@/server/queries/common"
import { getAppointments } from "@/server/queries/medical"
import type { AppointmentVM } from "@/server/queries/types"
import { CAPTION } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { EmptyState } from "@/components/shells/EmptyState"
import { SectionShell } from "@/components/shells/SectionShell"
import { Badge } from "@/components/ui/badge"
import { COPY } from "../copy"
import { frDateTime } from "../dates"
import { AppointmentSheet, StatusButtons } from "./AppointmentSheet"

export const metadata = { title: COPY.appointments.title }

const BODY = "text-[15px] leading-[22px] text-pretty text-foreground-secondary"

function Row({ a, timeZone }: { a: AppointmentVM; timeZone: string }) {
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-[22px] font-semibold">{a.title}</p>
          <p className={BODY}>
            {frDateTime(a.startsAt, timeZone)}
            {a.practitioner && ` · ${a.practitioner}`}
          </p>
          {a.location && <p className={CAPTION}>{a.location}</p>}
          {a.notes && <p className={cn(CAPTION, "mt-1 whitespace-pre-wrap")}>{a.notes}</p>}
        </div>
        {a.status !== "planned" && <Badge variant="secondary">{COPY.appointments[a.status]}</Badge>}
        <AppointmentSheet appointment={a} timeZone={timeZone} />
      </div>
      <div className="flex justify-end">
        <StatusButtons appointment={a} />
      </div>
    </li>
  )
}

/** Rendez-vous `/medical/appointments`: the ones to come, soonest first, then the past ones. */
export default async function AppointmentsPage() {
  await connection()
  const ctx = await userCtx()
  const all = await getAppointments(ctx)
  const upcoming = all.filter((a) => a.status === "planned" && a.startsAt >= ctx.now - 3600).sort((a, b) => a.startsAt - b.startsAt)
  const past = all.filter((a) => !upcoming.includes(a))
  const c = COPY.appointments
  return (
    <DetailShell
      title={c.title}
      backHref="/medical"
      action={<AppointmentSheet timeZone={ctx.timeZone} />}
      primary={
        all.length === 0 ? (
          <EmptyState body={c.empty} />
        ) : (
          <div className="flex flex-col gap-4">
            {upcoming.length > 0 && (
              <SectionShell variant="card" level={2} title={c.upcoming}>
                <ul className="divide-y divide-border">
                  {upcoming.map((a) => (
                    <Row key={a.id} a={a} timeZone={ctx.timeZone} />
                  ))}
                </ul>
              </SectionShell>
            )}
            {past.length > 0 && (
              <SectionShell variant="card" level={2} title={c.past}>
                <ul className="divide-y divide-border">
                  {past.map((a) => (
                    <Row key={a.id} a={a} timeZone={ctx.timeZone} />
                  ))}
                </ul>
              </SectionShell>
            )}
          </div>
        )
      }
    />
  )
}
