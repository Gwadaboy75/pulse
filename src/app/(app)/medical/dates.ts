// French date and time formatting for the medical module (the rest of the app formats in en-US, src/lib/format.ts).
const fr = new Map<string, Intl.DateTimeFormat>()
const fmt = (opts: Intl.DateTimeFormatOptions, timeZone?: string) => {
  const key = JSON.stringify([opts, timeZone])
  let f = fr.get(key)
  if (!f) fr.set(key, (f = new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone })))
  return f
}

/** "12 mars 2026" from a `YYYY-MM-DD` day. */
export const frDay = (day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) => fmt(opts, "UTC").format(new Date(`${day}T00:00:00Z`))
/** "mar. 12 mars, 09:30" from unix seconds in the user's zone. */
export const frDateTime = (ts: number, timeZone: string) => fmt({ weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }, timeZone).format(ts * 1000)
/** "09:30". */
export const frClock = (ts: number, timeZone: string) => fmt({ hour: "2-digit", minute: "2-digit" }, timeZone).format(ts * 1000)
/** The local wall time `YYYY-MM-DDTHH:MM` of an instant, for datetime-local inputs. */
export function wallOf(ts: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
/** A value with its unit, decimal comma. */
export const frValue = (v: number | null, text: string | null, unit: string | null) => (v === null ? (text ?? "—") : `${String(Math.round(v * 1000) / 1000).replace(".", ",")}${unit ? ` ${unit}` : ""}`)
