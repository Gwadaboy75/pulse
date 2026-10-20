import { describe, expect, it } from "vitest";
import { type HrvNight, hrvPanel, reference, SIGMA_FLOOR } from "./hrvReference";

const nights = (ms: (number | null)[]): HrvNight[] => ms.map((v, i) => ({ day: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), hrvMs: v }));

describe("HRV reference", () => {
  it("mean/SD reference excludes the night evaluated", () => {
    const series = [...Array.from({ length: 30 }, () => 50), 100];
    const r = hrvPanel(nights(series), { method: "mean_sd", referenceDays: 30 });
    // Reference is the 30 nights at 50 ms: ln 50, σ floored; the 100 ms night is far above the band.
    expect(r.value!.reference!.center).toBeCloseTo(Math.log(50), 9);
    expect(r.value!.reference!.sigma).toBe(SIGMA_FLOOR);
    expect(r.value!.z).toBeGreaterThan(5);
    expect(r.value!.latest!.ms).toBe(100);
  });
  it("median/MAD is robust to one outlier night in the reference", () => {
    const base = Array.from({ length: 29 }, (_, i) => 50 + (i % 3));
    const lns = [...base, 500].map((v) => Math.log(v));
    const m = reference(lns, "median_mad")!;
    const s = reference(lns, "mean_sd")!;
    expect(Math.exp(m.center)).toBeLessThan(53);
    expect(m.sigma).toBeLessThan(s.sigma);
  });
  it("the EWMA reference reuses the readiness ln baseline", () => {
    const r = reference(Array.from({ length: 20 }, () => Math.log(60)), "ewma")!;
    expect(Math.exp(r.center)).toBeCloseTo(60, 6);
    expect(r.valid).toBe(20);
  });
  it("needs 7 valid reference nights and 4 of the last 7 for the trend", () => {
    const r = hrvPanel(nights([50, 52, null, 48, 51, 50]), { method: "mean_sd", referenceDays: 60 });
    expect(r.value!.reference).toBeNull();
    expect(r.missing).toEqual(["reference"]);
    expect(r.value!.trend!.valid).toBe(5);
    expect(hrvPanel(nights([50, null, null, null, 51]), { method: "mean_sd", referenceDays: 60 }).value!.trend).toBeNull();
  });
  it("CV7 is the coefficient of variation of lnRMSSD over the last 7 nights", () => {
    const last7 = [40, 60, 45, 55, 50, 48, 52];
    const r = hrvPanel(nights([...Array.from({ length: 10 }, () => 50), ...last7]), { method: "mean_sd", referenceDays: 60 });
    const lns = last7.map((v) => Math.log(v));
    const mean = lns.reduce((a, b) => a + b, 0) / 7;
    const sd = Math.sqrt(lns.reduce((a, x) => a + (x - mean) ** 2, 0) / 6);
    expect(r.value!.cv7).toBe(Math.round((1000 * sd) / mean) / 10);
    expect(r.value!.trend!.ln).toBeCloseTo(mean, 9);
  });
  it("each point carries the band of the nights before it, and never uses later nights", () => {
    const r = hrvPanel(nights([...Array.from({ length: 10 }, () => 50), 80, 80, 80]), { method: "mean_sd", referenceDays: 60 });
    const p = r.value!.points;
    expect(p[10].hi).toBeCloseTo(Math.log(50) + 0.5 * SIGMA_FLOOR, 9);
    expect(p[0].lo).toBeNull();
    expect(p[12].hi).toBeGreaterThan(p[10].hi!);
  });
});
