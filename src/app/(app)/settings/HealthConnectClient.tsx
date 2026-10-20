"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Copy, QrCode, RefreshCw, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { createIngestEndpoint, type Pairing, removeIngestEndpoint, revealIngestPairing, rotateIngestSecret } from "@/server/actions/healthConnect"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type PairingAction = () => Promise<{ ok: true; data: Pairing } | { ok: false; error: string }>

const MONO = "rounded-lg bg-foreground/[0.06] px-3 py-2 font-mono text-[13px] leading-[18px] break-all select-all"

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error(`Couldn’t copy the ${what.toLowerCase()}`),
  )
}

/**
 * The pairing code: a QR for the app's "Scan a pairing code", and the URL and secret to type by hand. Shown once per
 * call and never kept in the page: closing the dialog drops it.
 */
function PairingDialog({ pairing, onClose }: { pairing: Pairing | null; onClose: () => void }) {
  return (
    <Dialog open={pairing !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="ring-1 ring-border">
        <DialogHeader>
          <DialogTitle>Pair your phone</DialogTitle>
          <DialogDescription>
            In Life Dashboard Companion, tap <b>Scan a pairing code</b> (setup, or the Health tab’s Webhook card) and scan this. The app sends a test ping right away.
          </DialogDescription>
        </DialogHeader>
        {pairing && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made for this dialog */}
            <img src={pairing.qr} alt="Pairing QR code" width={360} height={360} className="mx-auto size-60 rounded-xl bg-white p-2" />
            <details className="text-[13px] leading-[18px] text-foreground-secondary">
              <summary className="cursor-pointer select-none">Enter it by hand instead</summary>
              <div className="mt-2 space-y-2">
                <p>Webhook URL</p>
                <p className={MONO}>{pairing.url}</p>
                <p>HMAC signing secret</p>
                <p className={MONO}>{pairing.secret}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => copy(pairing.url, "URL")}>
                    <Copy aria-hidden className="size-4" /> Copy URL
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => copy(pairing.secret, "Secret")}>
                    <Copy aria-hidden className="size-4" /> Copy secret
                  </Button>
                </div>
              </div>
            </details>
            <p className="text-[13px] leading-[18px] text-pretty text-muted-foreground">
              Leave <b>Health</b> on in the app, pick the data types to send, and the phone posts to this server after every sync. Keep the secret to yourself: it is what makes a payload yours.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button size="touch" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Runs a pairing action and shows the code; the page refreshes behind the dialog so the card says "paired". */
function usePairing() {
  const router = useRouter()
  const [pairing, setPairing] = React.useState<Pairing | null>(null)
  const [pending, setPending] = React.useState(false)
  const run = async (action: PairingAction) => {
    setPending(true)
    const r = await action().catch(() => ({ ok: false as const, error: "Couldn’t reach Pulse. Try again." }))
    setPending(false)
    if (!r.ok) return toast.error(r.error)
    setPairing(r.data)
    router.refresh()
  }
  const dialog = <PairingDialog pairing={pairing} onClose={() => setPairing(null)} />
  return { run, pending, dialog }
}

/** No phone yet: creates the endpoint and shows its code. */
export function PairPhoneButton({ className }: { className?: string }) {
  const { run, pending, dialog } = usePairing()
  return (
    <>
      <Button size="touch" variant="default" className={className} disabled={pending} onClick={() => run(createIngestEndpoint)}>
        <Smartphone aria-hidden className="size-4" /> {pending ? "Preparing…" : "Pair phone"}
      </Button>
      {dialog}
    </>
  )
}

/** A paired phone: the same code again (a reinstall, a second phone). */
export function ShowPairingButton() {
  const { run, pending, dialog } = usePairing()
  return (
    <>
      <Button size="touch" variant="secondary" className="w-full" disabled={pending} onClick={() => run(revealIngestPairing)}>
        <QrCode aria-hidden className="size-4" /> Show code
      </Button>
      {dialog}
    </>
  )
}

/** A new secret on the same URL, after a confirmation: the phone stops being accepted until it scans the new code. */
export function RotateSecretButton() {
  const { run, pending, dialog } = usePairing()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="touch" variant="secondary" className="w-full" disabled={pending} onClick={() => setOpen(true)}>
        <RefreshCw aria-hidden className="size-4" /> New secret
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="ring-1 ring-border">
          <DialogHeader>
            <DialogTitle>Make a new secret?</DialogTitle>
            <DialogDescription>The phone’s payloads are refused until it scans the new code. The URL stays the same, and nothing already stored changes.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="touch" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="touch"
              onClick={() => {
                setOpen(false)
                void run(rotateIngestSecret)
              }}
            >
              New secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  )
}

/** Forgets the endpoint after a confirmation. The data the phone sent stays. */
export function UnpairPhoneButton() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const run = async () => {
    setPending(true)
    const r = await removeIngestEndpoint().catch(() => ({ ok: false as const, error: "network" }))
    setPending(false)
    if (!r.ok) return toast.error("Couldn’t unpair. Try again.")
    setOpen(false)
    toast.success("Phone unpaired")
    router.refresh()
  }
  return (
    <>
      <Button variant="outline" size="touch" className="w-full text-recovery-red-text" onClick={() => setOpen(true)}>
        Unpair
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent showCloseButton={false} className="ring-1 ring-border">
          <DialogHeader>
            <DialogTitle>Unpair this phone?</DialogTitle>
            <DialogDescription>The webhook address stops answering, so the app’s syncs fail until you pair again. Everything the phone sent stays on this server.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="touch" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="outline" size="touch" className="text-recovery-red-text" onClick={run} disabled={pending}>
              {pending ? "Unpairing…" : "Unpair"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
