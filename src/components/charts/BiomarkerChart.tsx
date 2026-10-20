"use client"

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts"
import { formatDay } from "@/lib/format"
import type { LabResultVM } from "@/server/queries/types"
import { ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { AXIS, ChartFigure, GRID, useSeriesAnimation } from "./ChartFrame"

const FLAG_COLOR: Record<string, string> = { low: "var(--warning)", high: "var(--recovery-red)", abnormal: "var(--recovery-red)", normal: "var(--optimal)" }

/**
 * One analyte over time: its results as a line with a dot per result (coloured by its flag), the latest reference
 * range as a band, and the band's bounds as dashed lines. Results that are not numbers are left out.
 */
export function BiomarkerChart({ points, range, unit, summary }: { points: LabResultVM[]; range: { low: number | null; high: number | null } | null; unit: string | null; summary: string }) {
  const anim = useSeriesAnimation()
  const data = points.filter((p) => p.value !== null).map((p) => ({ t: Date.parse(`${p.day}T12:00:00Z`), value: p.value as number, flag: p.flag, day: p.day }))
  const values = [...data.map((d) => d.value), ...(range ? [range.low, range.high].filter((v): v is number => v !== null) : [])]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.15
  return (
    <ChartFigure summary={summary} config={{ value: { label: unit ?? "", color: "var(--foreground)" } }} className="h-[220px]">
      <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={(t: number) => formatDay(new Date(t).toISOString().slice(0, 10), { month: "short", year: "2-digit" })} {...AXIS} minTickGap={32} />
        <YAxis domain={[lo - pad, hi + pad]} width={44} tickFormatter={(v: number) => String(Math.round(v * 100) / 100)} {...AXIS} />
        {range && (range.low !== null || range.high !== null) && (
          <ReferenceArea y1={range.low ?? lo - pad} y2={range.high ?? hi + pad} fill="var(--optimal)" fillOpacity={0.08} ifOverflow="hidden" />
        )}
        {range?.low !== null && range?.low !== undefined && <ReferenceLine y={range.low} stroke="var(--optimal)" strokeDasharray="3 4" strokeOpacity={0.6} />}
        {range?.high !== null && range?.high !== undefined && <ReferenceLine y={range.high} stroke="var(--optimal)" strokeDasharray="3 4" strokeOpacity={0.6} />}
        <ChartTooltip
          cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.2 }}
          content={<ChartTooltipContent labelFormatter={(_, p) => formatDay(String(p?.[0]?.payload?.day ?? ""), { day: "numeric", month: "long", year: "numeric" })} formatter={(v) => `${v}${unit ? ` ${unit}` : ""}`} />}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--foreground-secondary)"
          strokeWidth={2}
          connectNulls
          dot={(p: { cx?: number; cy?: number; payload?: { flag: string | null }; key?: React.Key | null }) => (
            <circle key={p.key ?? undefined} cx={p.cx} cy={p.cy} r={4.5} fill={FLAG_COLOR[p.payload?.flag ?? ""] ?? "var(--foreground)"} stroke="var(--card)" strokeWidth={2} />
          )}
          activeDot={{ r: 6 }}
          {...anim}
        />
      </LineChart>
    </ChartFigure>
  )
}
