import { describe, test, expect } from "vitest";
import { computeVictoryProgress } from "./victoryProgress.js";

// Synthetic world — regions keyed by rgbKey like App.js's `regions` state.
// Each entry: { region, city, faction, rebelDefault }. hold_regions entries
// are CITY names (stock RTW convention) unless a test says otherwise.
const REGIONS = {
  "10,20,30": { region: "Latium", city: "Rome", faction: "romans_julii" },
  "11,21,31": { region: "Etruria", city: "Arretium", faction: "romans_julii" },
  "12,22,32": { region: "Umbria", city: "Ariminum", faction: "romans_julii" },
  "13,23,33": { region: "Campania", city: "Capua", faction: "romans_scipii" },
  "14,24,34": { region: "Apulia", city: "Tarentum", faction: "greek_cities" },
  "15,25,35": { region: "Sicilia", city: "Syracuse", faction: "greek_cities" },
  "16,26,36": { region: "Bruttium", city: "Croton", faction: "slave", rebelDefault: "slave" },
};

describe("computeVictoryProgress", () => {
  test("defensive: missing/invalid inputs return []", () => {
    expect(computeVictoryProgress()).toEqual([]);
    expect(computeVictoryProgress({})).toEqual([]);
    expect(computeVictoryProgress({ victoryConditions: null, regions: REGIONS })).toEqual([]);
    expect(computeVictoryProgress({ victoryConditions: {}, regions: REGIONS })).toEqual([]);
    // conditions present but no regions loaded: entries survive as unmatched
    const r = computeVictoryProgress({ victoryConditions: { a: { hold_regions: ["Rome"], take_regions: null } } });
    expect(r).toHaveLength(1);
    expect(r[0].missing[0]).toMatchObject({ region: "Rome", unmatched: true });
  });

  test("fully complete, partial, and no-condition factions; sorted by pct desc", () => {
    const victoryConditions = {
      // complete: julii owns all three of its targets
      romans_julii: { hold_regions: ["Rome", "Arretium", "Ariminum"], take_regions: null },
      // partial: owns Capua only; Rome is julii's, Syracuse is greek
      romans_scipii: { hold_regions: ["Capua", "Rome", "Syracuse"], take_regions: null },
      // no conditions at all → omitted from output
      gauls: { hold_regions: [], take_regions: null },
    };
    const rows = computeVictoryProgress({ victoryConditions, regions: REGIONS });
    expect(rows.map((r) => r.faction)).toEqual(["romans_julii", "romans_scipii"]);

    const [julii, scipii] = rows;
    expect(julii).toMatchObject({ requiredCount: 3, heldCount: 3, pct: 100 });
    expect(julii.missing).toEqual([]);

    expect(scipii).toMatchObject({ requiredCount: 3, heldCount: 1 });
    expect(scipii.pct).toBeCloseTo((1 / 3) * 100, 5);
    expect(scipii.missing).toEqual([
      { region: "Latium", city: "Rome", currentOwner: "romans_julii" },
      { region: "Sicilia", city: "Syracuse", currentOwner: "greek_cities" },
    ]);
    expect(scipii.conditionsText).toBe("Hold 3 settlements");
  });

  test("hold_regions entries match by REGION name too (dev-paint convention), case-insensitive", () => {
    const victoryConditions = {
      greek_cities: { hold_regions: ["apulia", "SICILIA", "Nowhere_Land"], take_regions: null },
    };
    const [g] = computeVictoryProgress({ victoryConditions, regions: REGIONS });
    expect(g.heldCount).toBe(2);
    expect(g.missing).toEqual([{ region: "Nowhere_Land", city: null, currentOwner: null, unmatched: true }]);
  });

  test("count-based take_regions: held = min(N, owned), combined with hold list", () => {
    const victoryConditions = {
      // greek_cities owns 2 regions; must hold Syracuse (owned) and take 5 total
      greek_cities: { hold_regions: ["Syracuse"], take_regions: 5 },
      // pure count-based
      romans_julii: { hold_regions: [], take_regions: 3 },
    };
    const rows = computeVictoryProgress({ victoryConditions, regions: REGIONS });
    // julii owns 3/3 → 100%; greeks (1+2)/(1+5) = 50%
    expect(rows.map((r) => r.faction)).toEqual(["romans_julii", "greek_cities"]);
    expect(rows[0]).toMatchObject({ requiredCount: 3, heldCount: 3, pct: 100, takeRequired: 3, takeHeld: 3, ownedCount: 3 });
    expect(rows[0].conditionsText).toBe("Take 3 regions total");
    expect(rows[1]).toMatchObject({ requiredCount: 6, heldCount: 3, pct: 50, holdHeld: 1, takeHeld: 2, ownedCount: 2 });
    expect(rows[1].conditionsText).toBe("Hold 1 settlement · Take 5 regions total");
  });

  test("live-save ownership overrides descr_strat: currentOwnerByCity > initialOwnerByCity > region.faction", () => {
    const victoryConditions = {
      romans_scipii: { hold_regions: ["Rome", "Capua"], take_regions: null },
    };
    // Save says scipii captured Rome; initial map would give Capua to gauls but
    // the region.faction fallback is only used when both city maps miss.
    const currentOwnerByCity = { Rome: "romans_scipii" };
    const initialOwnerByCity = { Capua: "romans_scipii", Rome: "romans_julii" };
    const [s] = computeVictoryProgress({ victoryConditions, regions: REGIONS, currentOwnerByCity, initialOwnerByCity });
    expect(s).toMatchObject({ heldCount: 2, requiredCount: 2, pct: 100 });

    // Without the save, current map absent → initial map wins for Rome
    const [s2] = computeVictoryProgress({ victoryConditions, regions: REGIONS, initialOwnerByCity });
    expect(s2.heldCount).toBe(1); // Capua via initial map; Rome initial → julii
    expect(s2.missing).toEqual([{ region: "Latium", city: "Rome", currentOwner: "romans_julii" }]);
  });

  test("ties sort by faction id ascending for a stable list", () => {
    const victoryConditions = {
      b_faction: { hold_regions: ["Rome"], take_regions: null },
      a_faction: { hold_regions: ["Capua"], take_regions: null },
    };
    const rows = computeVictoryProgress({ victoryConditions, regions: REGIONS });
    expect(rows.map((r) => r.pct)).toEqual([0, 0]);
    expect(rows.map((r) => r.faction)).toEqual(["a_faction", "b_faction"]);
  });
});
