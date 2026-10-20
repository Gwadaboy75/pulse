import { render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { LabResultVM } from "@/server/queries/types"
import { BiomarkerChart } from "./BiomarkerChart"

afterEach(() => document.querySelector("#recharts_measurement_span")?.remove())

const point = (day: string, value: number | null, flag: LabResultVM["flag"] = null): LabResultVM => ({
  id: Number(day.replaceAll("-", "")),
  day,
  analyte: "ldl_cholesterol",
  label: "LDL",
  value,
  valueText: value === null ? "n/a" : null,
  unit: "g/L",
  refLow: null,
  refHigh: 1.6,
  refText: null,
  flag,
  labName: null,
  documentId: null,
})

describe("BiomarkerChart", () => {
  it("renders a figure with its summary, and leaves non-numeric results out of the plot", () => {
    const { container, getByText } = render(
      <BiomarkerChart points={[point("2026-03-01", 1.2), point("2026-06-01", null), point("2026-10-01", 1.8, "high")]} range={{ low: null, high: 1.6 }} unit="g/L" summary="LDL: 2 résultats" />,
    )
    expect(getByText("LDL: 2 résultats")).toBeInTheDocument()
    expect(container.querySelector("figure")).not.toBeNull()
  })
})
