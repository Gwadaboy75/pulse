import { Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"
import { ago } from "@/lib/format"
import type { HealthConnectVM } from "@/server/queries/types"
import { SectionShell } from "@/components/shells/SectionShell"
import { SyncNowButton } from "@/components/shells/SyncNowButton"
import { PairPhoneButton, RotateSecretButton, ShowPairingButton, UnpairPhoneButton } from "./HealthConnectClient"

const BODY = "max-w-[65ch] text-[15px] leading-[22px] text-pretty text-foreground-secondary"
const TILE = "grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-foreground/[0.06]"
const APP_URL = "https://github.com/owen282000/life-dashboard-companion-app"

/** The status line under the name. */
function line(hc: HealthConnectVM, now: number): { text: string; tone?: string } {
  if (hc.status === "error" && hc.error) return { text: hc.error, tone: "text-recovery-red-text" }
  if (!hc.lastReceivedAt) return { text: "Paired, waiting for the first sync", tone: "text-warning-text" }
  const received = `Received ${ago(hc.lastReceivedAt, now)}`
  if (hc.status === "stale") return { text: `${received}. The phone hasn’t synced in a while`, tone: "text-warning-text" }
  return { text: hc.appVersion ? `${received} · app ${hc.appVersion}` : received }
}

/**
 * Settings › Data source › the phone (spec §7.14, the Health Connect path). As the Data source card when the
 * instance has no Google client (`primary`), else a second card under Google's. The code (URL + secret) is only ever
 * shown through its buttons, never rendered with the page.
 */
export function HealthConnect({ hc, now, primary, role }: { hc: HealthConnectVM | null; now: number; primary: boolean; role?: React.ReactNode }) {
  const title = primary ? "Data source" : "Phone"
  const id = primary ? "source" : "phone"
  if (!hc) {
    return (
      <SectionShell variant="card" level={2} id={id} title={title}>
        <div className="flex min-h-11 items-center gap-3">
          <span aria-hidden className={TILE}>
            <Smartphone className="size-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-[22px] font-semibold">Health Connect</p>
            <p className="truncate text-[13px] leading-[18px] text-muted-foreground">No phone paired</p>
          </div>
        </div>
        <p className={cn(BODY, "mt-3")}>
          Your Fitbit app writes to Health Connect on your phone. The free{" "}
          <a href={APP_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Life Dashboard Companion
          </a>{" "}
          app sends it to this server after every sync: heart rate, steps, sleep stages, HRV, resting heart rate, breathing rate, SpO2, skin temperature, workouts, weight. Pulse scores it here.
          {primary ? "" : " Beside Google it fills in what Google leaves out."}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <PairPhoneButton className="col-span-2 w-full" />
        </div>
      </SectionShell>
    )
  }
  const l = line(hc, now)
  return (
    <SectionShell variant="card" level={2} id={id} title={title}>
      <div className="flex min-h-11 items-center gap-3">
        <span aria-hidden className={TILE}>
          <Smartphone className="size-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-[22px] font-semibold">Health Connect</p>
          <p className={cn("truncate text-[13px] leading-[18px] text-muted-foreground tabular-nums", l.tone)}>{l.text}</p>
        </div>
      </div>
      {!hc.url && (
        <p role="note" className={cn(BODY, "mt-3 text-warning-text")}>
          Set APP_URL on the server to the address your phone can reach; the pairing code needs it.
        </p>
      )}
      {hc.lastReceivedAt && hc.lastAppliedAt === null && hc.status !== "error" && (
        <p className={cn(BODY, "mt-3")}>The first payloads arrived; the next sync run scores them.</p>
      )}
      {role}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <SyncNowButton className="w-full" />
        <ShowPairingButton />
        <RotateSecretButton />
        <UnpairPhoneButton />
      </div>
    </SectionShell>
  )
}
