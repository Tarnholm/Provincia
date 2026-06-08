import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseSettlementFields } from "./settlementFieldsParser.js";
import { findAllSettlementMarkers } from "./buildingParser.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { crackSave } = require("./saveCracker.js");

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
    // PRECONDITION: these slot values are pinned to a FRESH Carthage turn-1
    // state. save_Carthage1.sav is a live file the user re-saves during play —
    // skip (visibly) if it has drifted to a different faction/turn (e.g. tax=0
    // only holds before any tax rate is set on turn 1).
    const r = crackSave(buf, "C:\\RIS\\RIS\\data");
    if (r.playerFaction !== "carthage" || r.turn !== 1) {
      console.warn(`[test-skip] s11/s12/s2 Carthage T1: save not in expected state (player=${r.playerFaction}, turn=${r.turn}; expected carthage turn 1)`);
      return;
    }
    const fields = parseSettlementFields(buf, findAllSettlementMarkers(buf));
    const cap = fields["Carthage"];   // faction capital
    const far = fields["Tingi"];      // far-flung holding (dist ~188 tiles)
    // Cities may be absent if the save drifted (e.g. Tingi lost); skip rather
    // than hard-fail.
    if (!cap || !far) {
      console.warn("[test-skip] s11/s12/s2 Carthage T1: expected settlements (Carthage/Tingi) not present in loaded save");
      return;
    }

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
  }, 30000); // heavy: crackSave precondition + marker scan on a 34 MB save

  // CONFIRMED 2026-05-31 (findings-order-slots-v3): s10 = capital-status bonus,
  // s7 = turn-1-only start transient. Pinned against the real local saves.
  const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
  test("order slot s10 = capital bonus (single high city = Carthage), s7 = turn-1 transient", () => {
    const t1 = path.join(SAVES_DIR, "save_Carthage1.sav");
    const t3 = path.join(SAVES_DIR, "save_carthage3.sav");
    if (!fs.existsSync(t1) || !fs.existsSync(t3)) return; // machine-local assets

    const buf1 = fs.readFileSync(t1);
    const f1 = parseSettlementFields(buf1, findAllSettlementMarkers(buf1));

    // s10 capital bonus: within the PLAYER FACTION'S OWN cities, exactly one
    // carries the high value, and it is the capital (Carthage). (Globally other
    // factions' capitals also carry it — the bonus is per-faction, one per empire.)
    const r1 = crackSave(buf1, "C:\\RIS\\RIS\\data");
    // These assertions assume a FRESH Carthage turn-1 save. The live SAVES_DIR
    // copies get re-saved during play (different campaign/turn), so skip rather
    // than hard-fail when the file is no longer that exact state.
    if (r1.playerFaction !== "carthage" || r1.turn !== 1) return;
    if (!f1["Tingi"] || !f1["Hadrumetum"] || !f1["Carthage"]) return;
    const own = (r1.factions[r1.playerFaction] && r1.factions[r1.playerFaction].regions) || [];
    expect(own.length).toBeGreaterThan(10);
    const s10 = own.map((name) => ({ name, v: f1[name] ? f1[name].order.capitalBonus : 0 }));
    const maxV = Math.max(...s10.map((c) => c.v));
    const topCities = s10.filter((c) => c.v === maxV);
    expect(maxV).toBeGreaterThanOrEqual(4);          // capital bonus is a clear positive
    expect(topCities.length).toBe(1);                 // exactly one capital per faction
    expect(topCities[0].name).toBe("Carthage");
    expect(f1["Carthage"].order.capitalBonus).toBe(f1["Carthage"].orderBreakdown[10]);

    // s7 start transient: nonzero on the player's own frontier cities at turn 1
    // (Tingi=2, Hadrumetum=4), and 0 once that faction has ended its first turn.
    expect(f1["Tingi"].order.startTransientBonus).toBeGreaterThan(0);
    expect(f1["Hadrumetum"].order.startTransientBonus).toBeGreaterThan(0);

    const buf3 = fs.readFileSync(t3);
    const f3 = parseSettlementFields(buf3, findAllSettlementMarkers(buf3));
    // Same campaign continued; skip the turn-3 checks if the file was re-saved
    // into a different state (cities absent).
    if (f3["Tingi"] && f3["Hadrumetum"] && f3["Carthage"]) {
      expect(f3["Tingi"].order.startTransientBonus).toBe(0);     // transient gone by turn 3
      expect(f3["Hadrumetum"].order.startTransientBonus).toBe(0);
      // s10 capital bonus stays a clear positive. (We don't assert == the turn-1
      // maxV: the live SAVES_DIR turn-1/turn-3 files get independently re-saved
      // across mod updates, so they're no longer guaranteed to be the same campaign.)
      expect(f3["Carthage"].order.capitalBonus).toBeGreaterThanOrEqual(4);
    }
  }, 30000); // heavy: full crackSave + marker scans on 34 MB saves

  // CONFIRMED 2026-05-31 (findings-order-slots-v4): s9 = HEALTH/SEWERAGE happiness.
  // On a turn-START save (deferral settled) s9>0 ⇔ a sanitation/health building is
  // present, and the magnitude dose-responds to health tier. Pinned on julii2
  // (turn 2 start: 14 tp / 11 tn, zero mismatches) cross-referencing the building
  // parser's `health`/`hospitals` (tag=sanitation) chains.
  test("order slot s9 = health/sewerage bonus (presence ⇔ sanitation building, julii T2)", () => {
    const sv = path.join(SAVES_DIR, "save_julii2.sav");
    if (!fs.existsSync(sv)) return; // machine-local asset
    const buf = fs.readFileSync(sv);
    const fields = parseSettlementFields(buf, findAllSettlementMarkers(buf));
    const r = crackSave(buf, "C:\\RIS\\RIS\\data");
    // PRECONDITION: this is pinned to the julii turn-2-START state (player owns
    // Rome, deferral settled). save_julii2.sav is a live file the user re-saves;
    // skip (visibly) if it's no longer a romans_julii early-turn save with Rome.
    if (r.playerFaction !== "romans_julii" || !fields["Rome"]) {
      console.warn(`[test-skip] s9 health julii T2: save not in expected state (player=${r.playerFaction}, hasRome=${!!fields["Rome"]}; expected romans_julii holding Rome)`);
      return;
    }
    const own = (r.factions[r.playerFaction] && r.factions[r.playerFaction].regions) || [];
    expect(own.length).toBeGreaterThan(10);

    const { parseSettlements } = require("./buildingParser.js");
    const blds = {};
    for (const st of parseSettlements(buf, null, null).settlements) {
      blds[st.name] = (st.buildings || []).map((b) => b.name);
    }
    const hasHealth = (name) =>
      (blds[name] || []).some((n) => n === "health" || n === "hospitals");

    // s9 presence must agree with a health building's presence, with no
    // mismatches across the player's own cities on this turn-start save.
    let mismatch = 0, tp = 0, tn = 0;
    for (const name of own) {
      const f = fields[name];
      if (!f) continue;
      const s9 = f.order.healthBonus > 0;
      const h = hasHealth(name);
      if (s9 && h) tp++;
      else if (!s9 && !h) tn++;
      else mismatch++;
    }
    expect(tp).toBeGreaterThan(5);
    expect(tn).toBeGreaterThan(5);
    expect(mismatch).toBe(0);

    // Rome has the highest-tier health building and the highest s9 in the empire.
    expect(fields["Rome"].order.healthBonus).toBeGreaterThanOrEqual(5);
    // named slot is a faithful view of the raw array.
    expect(fields["Rome"].order.healthBonus).toBe(fields["Rome"].orderBreakdown[9]);
  }, 30000); // parseSettlements scans the whole save — allow extra time
});
