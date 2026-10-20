import { describe, expect, it } from "vitest";
import { FORMULA_IDS, FORMULAS } from "./registry";

describe("formula registry", () => {
  it("every entry has a version, at least one source, a domain and its id as key", () => {
    for (const id of FORMULA_IDS) {
      const f = FORMULAS[id];
      expect(f.id).toBe(id);
      expect(f.version).toBeTruthy();
      expect(f.sources.length).toBeGreaterThan(0);
      expect(f.domain.length).toBeGreaterThan(20);
      expect(f.name).toBeTruthy();
    }
  });
  it("no local method is named after a manufacturer's product", () => {
    for (const id of FORMULA_IDS) expect(FORMULAS[id].name).not.toMatch(/^(Google|WHOOP|Oura|Garmin|Apple|Bevel)\b/);
  });
});
