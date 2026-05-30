import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseSettlementFields } from "./settlementFieldsParser.js";
import { findAllSettlementMarkers } from "./buildingParser.js";

const SAVE = path.join("bundled-mod", "saves", "sample.sav");

describe("parseSettlementFields", () => {
  test("decodes plausible per-settlement fields from the bundled save", () => {
    if (!fs.existsSync(SAVE)) return; // skip if asset absent
    const buf = fs.readFileSync(SAVE);
    const fields = parseSettlementFields(buf, findAllSettlementMarkers(buf));
    const names = Object.keys(fields);
    expect(names.length).toBeGreaterThan(50);

    let plausiblePop = 0, plausibleOrder = 0;
    for (const f of Object.values(fields)) {
      if (f.committedPopulation != null && f.committedPopulation >= 0 && f.committedPopulation < 200000) plausiblePop++;
      if (f.publicOrder != null && f.publicOrder >= -200 && f.publicOrder <= 1000) plausibleOrder++;
      // orderBreakdown is always an 18-slot numeric array
      expect(Array.isArray(f.orderBreakdown)).toBe(true);
      expect(f.orderBreakdown.length).toBe(18);
    }
    // the vast majority should have a sane population + order
    expect(plausiblePop).toBeGreaterThan(names.length * 0.8);
    expect(plausibleOrder).toBeGreaterThan(names.length * 0.8);
  });

  test("population growth = projected - committed (roll-forward consistency)", () => {
    if (!fs.existsSync(SAVE)) return;
    const buf = fs.readFileSync(SAVE);
    const fields = parseSettlementFields(buf, findAllSettlementMarkers(buf));
    for (const f of Object.values(fields)) {
      if (f.committedPopulation != null && f.projectedPopulation != null) {
        expect(f.populationGrowth).toBe(f.projectedPopulation - f.committedPopulation);
      }
    }
  });
});
