"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { deleteAppointment, saveAppointment, setAppointmentStatus } from "@/server/actions/medical"
import type { AppointmentVM } from "@/server/queries/types"
import { Button } from "@/components/ui/button"
import { COPY } from "../copy"
import { wallOf } from "../dates"
import { AREA, Field, FIELD, FormSheet, num } from "../form"

type Draft = { title: string; startsAt: string; durationMin: string; location: string; practitioner: string; notes: string }

const draftOf = (a: AppointmentVM | undefined, timeZone: string): Draft => ({
  title: a?.title ?? "",
  startsAt: a ? wallOf(a.startsAt, timeZone) : "",
  durationMin: a?.endsAt ? String(Math.round((a.endsAt - a.startsAt) / 60)) : "",
  location: a?.location ?? "",
  practitioner: a?.practitioner ?? "",
  notes: a?.notes ?? "",
})

/** Add (no `appointment`) or edit an appointment in a sheet; editing offers Delete. */
export function AppointmentSheet({ appointment, timeZone }: { appointment?: AppointmentVM; timeZone: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [d, setD] = React.useState<Draft>(() => draftOf(appointment, timeZone))
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value })
  const c = COPY.appointments
  return (
    <>
      {appointment ? (
        <Button size="icon-touch" variant="ghost" aria-label={COPY.common.save} onClick={() => (setD(draftOf(appointment, timeZone)), setOpen(true))}>
          <Pencil aria-hidden strokeWidth={1.75} />
        </Button>
      ) : (
        <Button size="touch" variant="secondary" onClick={() => (setD(draftOf(undefined, timeZone)), setOpen(true))}>
          <Plus aria-hidden /> {c.add}
        </Button>
      )}
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={c.add}
        onSubmit={() => saveAppointment({ id: appointment?.id, title: d.title, startsAt: d.startsAt, durationMin: num(d.durationMin), location: d.location, practitioner: d.practitioner, notes: d.notes, status: appointment?.status ?? "planned" })}
        onSaved={() => {
          toast.success(COPY.common.save)
          router.refresh()
        }}
        destructive={
          appointment && {
            label: c.delete,
            confirm: `${c.delete} ?`,
            run: async () => {
              const r = await deleteAppointment(appointment.id)
              if (r.ok) router.refresh()
              return r
            },
          }
        }
      >
        <Field id="appt-title" label={c.fields.title}>
          <input id="appt-title" className={FIELD} value={d.title} onChange={set("title")} required />
        </Field>
        <Field id="appt-start" label={c.fields.startsAt}>
          <input id="appt-start" type="datetime-local" className={FIELD} value={d.startsAt} onChange={set("startsAt")} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="appt-duration" label={c.fields.durationMin} optional>
            <input id="appt-duration" className={FIELD} value={d.durationMin} onChange={set("durationMin")} inputMode="numeric" />
          </Field>
          <Field id="appt-practitioner" label={c.fields.practitioner} optional>
            <input id="appt-practitioner" className={FIELD} value={d.practitioner} onChange={set("practitioner")} />
          </Field>
        </div>
        <Field id="appt-location" label={c.fields.location} optional>
          <input id="appt-location" className={FIELD} value={d.location} onChange={set("location")} />
        </Field>
        <Field id="appt-notes" label={c.fields.notes} optional>
          <textarea id="appt-notes" className={AREA} value={d.notes} onChange={set("notes")} />
        </Field>
      </FormSheet>
    </>
  )
}

/** Marks an appointment done or cancelled. */
export function StatusButtons({ appointment }: { appointment: AppointmentVM }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const run = async (status: "done" | "cancelled" | "planned") => {
    setPending(true)
    const r = await setAppointmentStatus(appointment.id, status).catch(() => ({ ok: false as const, error: COPY.common.error }))
    setPending(false)
    if (!r.ok) return toast.error(r.error)
    router.refresh()
  }
  if (appointment.status !== "planned")
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run("planned")}>
        {COPY.appointments.planned}
      </Button>
    )
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run("done")}>
        {COPY.appointments.markDone}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("cancelled")}>
        {COPY.appointments.cancel}
      </Button>
    </div>
  )
}
