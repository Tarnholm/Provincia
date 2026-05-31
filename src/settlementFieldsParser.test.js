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

  // CONFIRMED order-breakdown slot mapping (2026-05-31). Pinned against the
  // real Carthage turn-1 save when present on this machine (skips otherwise).
  // s11 = distance-to-capital penalty (0 at the capital, grows with distance);
  // s12 = religious/cultural-unrest penalty (0 for the culturally-homogeneous
  // Carthaginian empire); s2 = tax (0 before any tax rate is set, e.g. turn 1).
  const CARTHAGE_SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Carthage1.sav";
  test("order slot s11 = distance-to-capital, s12 = religion, s2 = tax (Carthage T1)", () => {
    if (!fs.existsSync(CARTHAGE_SAVE)) return; // machine-local asset
    const buf = fs.readFileSync(CARTHAGE_SAVE);
    const fields = parseSettlementFields(buf, findAllSettlementMarkers(buf));
    const cap = fields["Carthage"];   // faction capital
    const far = fields["Tingi"];      // far-flung holding (dist ~188 tiles)
    expect(cap).toBeTruthy();
    expect(far).toBeTruthy();

    // s11 distance-to-capital: 0 at the capital, clearly positive far away.
    expect(cap.order.distanceToCapitalPenalty).toBe(0);
    expect(far.order.distanceToCapitalPenalty).toBeGreaterThanOrEqual(5);
    expect(far.order.distanceToCapitalPenalty).toBeGreaterThan(cap.order.distanceToCapitalPenalty);

    // s12 religious/cultural unrest: zero throughout the homogeneous Carthaginian empire.
    expect(cap.order.religiousUnrestPenalty).toBe(0);
    expect(far.order.religiousUnrestPenalty).toBe(0);

    // s2 tax: zero at a fresh turn-1 start (no tax rate processed yet).
    expect(cap.order.tax).toBe(0);

    // named slots are a faithful view onto the raw array.
    expect(cap.order.distanceToCapitalPenalty).toBe(cap.orderBreakdown[11]);
    expect(cap.order.religiousUnrestPenalty).toBe(cap.orderBreakdown[12]);
    expect(cap.order.tax).toBe(cap.orderBreakdown[2]);
  });
});
