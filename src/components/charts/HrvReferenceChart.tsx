"use client"

import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { formatDay } from "@/lib/format"
import type { HrvPoint } from "@/core/formulas/hrvReference"
import { ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { AXIS, ChartFigure, GRID, useSeriesAnimation } from "./ChartFrame"

/**
 * Nightly HRV (ms, log axis in effect since the band is built on ln) with, for each night, the band it was judged
 * against: the reference of the nights before it, ±0.5 σ. A night above the band is higher than usual, below it lower.
 */
export function HrvReferenceChart({ points, summary, days = 60 }: { points: HrvPoint[]; summary: string; days?: number }) {
  const anim = useSeriesAnimation()
  const data = points.slice(-days).map((p) => ({
    day: p.day,
    t: Date.parse(`${p.day}T12:00:00Z`),
    ms: p.ms,
    band: p.lo != null && p.hi != null ? [Math.exp(p.lo), Math.exp(p.hi)] : null,
  }))
  const values = data.flatMap((d) => [d.ms, ...(d.band ?? [])]).filter((v): v is number => v != null)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 100
  const pad = (hi - lo || 10) * 0.15
  return (
    <ChartFigure summary={summary} config={{ ms: { label: "ms", color: "var(--foreground)" }, band: { label: "bande", color: "var(--chart-band)" } }} className="h-[220px]">
      <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={(t: number) => formatDay(new Date(t).toISOString().slice(0, 10), { day: "numeric", month: "short" })} {...AXIS} minTickGap={32} />
        <YAxis domain={[Math.max(0, lo - pad), hi + pad]} width={40} tickFormatter={(v: number) => String(Math.round(v))} {...AXIS} />
        <Area type="monotone" dataKey="band" stroke="none" fill="var(--chart-band)" fillOpacity={1} connectNulls={false} {...anim} />
        <ChartTooltip
          cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.2 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => formatDay(String(p?.[0]?.payload?.day ?? ""), { day: "numeric", month: "long" })}
              formatter={(v, name) => (name === "band" && Array.isArray(v) ? `${Math.round(v[0])}–${Math.round(v[1])} ms` : `${Math.round(Number(v))} ms`)}
            />
          }
        />
        <Line type="monotone" dataKey="ms" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: "var(--foreground)" }} connectNulls={false} {...anim} />
      </ComposedChart>
    </ChartFigure>
  )
}
