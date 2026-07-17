// Hermetic unit tests for src/campaignAutopsy.js — synthetic timeline rows only;
// no save files, no workers, no I/O. Rows use the timeline-row shape produced by
// scripts/campaign-timeline.js extractRow (the shape summarizeForCompare and thus
// analyzeCampaign consume): { turn, _ownerByCity, player, treasury, units }.
import { describe, test, expect } from "vitest";
import { analyzeCampaign } from "./campaignAutopsy.js";

// Build an _ownerByCity map giving each faction `n` distinct settlements. Only
// the COUNT matters to the autopsy, so the keys are synthetic-but-unique.
function ownerMap(counts) {
  const m = {};
  for (const [fac, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) m[`${fac}_city_${i}`] = fac;
  }
  return m;
}

// A four-faction campaign over turns 1..5:
//   romans   2,4,6,7,8  — steady growth, ends on top          → dominant (winner)
//   gauls    3,5,6,4,2  — grow then collapse (peak 6 @ T3)    → declining
//   carthage 4,3,1,0,0  — bled out, wiped at T4               → eliminated
//   greeks   2,2,2,2,2  — flat                                → stagnant
// `player` rotates so each save's tracked-faction treasury/units land in that
// faction's series (mirrors a real per-save timeline where each save has one player).
function campaignRows() {
  const perTurn = [
    { turn: 1, counts: { romans: 2, gauls: 3, carthage: 4, greeks: 2 }, player: "romans",   treasury: 1000, units: 5 },
    { turn: 2, counts: { romans: 4, gauls: 5, carthage: 3, greeks: 2 }, player: "gauls",     treasury: 2000, units: 9 },
    { turn: 3, counts: { romans: 6, gauls: 6, carthage: 1, greeks: 2 }, player: "carthage",  treasury: 300,  units: 2 },
    { turn: 4, counts: { romans: 7, gauls: 4, carthage: 0, greeks: 2 }, player: "romans",    treasury: 5000, units: 14 },
    { turn: 5, counts: { romans: 8, gauls: 2, carthage: 0, greeks: 2 }, player: "greeks",    treasury: 1200, units: 4 },
  ];
  return perTurn.map((t) => ({
    turn: t.turn,
    _ownerByCity: ownerMap(t.counts),
    player: t.player,
    treasury: t.treasury,
    units: t.units,
  }));
}

describe("analyzeCampaign", () => {
  test("empty / non-array input is defensive", () => {
    for (const bad of [null, undefined, [], "nope", {}]) {
      const r = analyzeCampaign(bad);
      expect(r.factions).toEqual([]);
      expect(r.turns).toEqual([]);
      expect(r.winner).toBe(null);
    }
  });

  test("builds the turn axis and faction universe", () => {
    const r = analyzeCampaign(campaignRows());
    expect(r.turns).toEqual([1, 2, 3, 4, 5]);
    expect(r.factions.map((f) => f.faction).sort()).toEqual(["carthage", "gauls", "greeks", "romans"]);
    // Every faction carries a full-length series aligned to the turn axis.
    for (const f of r.factions) {
      expect(f.series.map((s) => s.turn)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  test("winner is the faction with the most final settlements", () => {
    const r = analyzeCampaign(campaignRows());
    expect(r.winner).toBe("romans");
  });

  test("factions are sorted by final settlements (peak breaks ties)", () => {
    const r = analyzeCampaign(campaignRows());
    // romans 8, gauls 2 (peak 6), greeks 2 (peak 2), carthage 0
    expect(r.factions.map((f) => f.faction)).toEqual(["romans", "gauls", "greeks", "carthage"]);
  });

  test("dominant winner: growth held to the end", () => {
    const romans = analyzeCampaign(campaignRows()).factions.find((f) => f.faction === "romans");
    expect(romans.verdict).toBe("dominant");
    expect(romans.finalSettlements).toBe(8);
    expect(romans.peak).toEqual({ turn: 5, settlements: 8 });
    expect(romans.firstDecline).toBe(null);
    expect(romans.eliminated).toBe(null);
  });

  test("grow-then-collapse: peak, first decline, declining verdict", () => {
    const gauls = analyzeCampaign(campaignRows()).factions.find((f) => f.faction === "gauls");
    expect(gauls.peak).toEqual({ turn: 3, settlements: 6 });
    expect(gauls.firstDecline).toEqual({ turn: 4 }); // 6 → 4 at T4, never recovers
    expect(gauls.eliminated).toBe(null);
    expect(gauls.finalSettlements).toBe(2);
    expect(gauls.verdict).toBe("declining");
  });

  test("eliminated: detects the wipe turn and verdict", () => {
    const carthage = analyzeCampaign(campaignRows()).factions.find((f) => f.faction === "carthage");
    expect(carthage.peak).toEqual({ turn: 1, settlements: 4 });
    expect(carthage.eliminated).toEqual({ turn: 4 }); // first turn at 0 after holding land
    expect(carthage.finalSettlements).toBe(0);
    expect(carthage.verdict).toBe("eliminated");
  });

  test("flat trajectory: stagnant verdict, no decline, no elimination", () => {
    const greeks = analyzeCampaign(campaignRows()).factions.find((f) => f.faction === "greeks");
    expect(greeks.verdict).toBe("stagnant");
    expect(greeks.firstDecline).toBe(null);
    expect(greeks.eliminated).toBe(null);
    expect(greeks.finalSettlements).toBe(2);
    expect(greeks.peak).toEqual({ turn: 1, settlements: 2 });
  });

  test("tracked-faction treasury/units land in that faction's series; others null", () => {
    const r = analyzeCampaign(campaignRows());
    const romans = r.factions.find((f) => f.faction === "romans");
    // romans is the tracked player at turns 1 and 4 → those get treasury/units.
    expect(romans.series[0].treasury).toBe(1000);
    expect(romans.series[0].units).toBe(5);
    expect(romans.series[3].treasury).toBe(5000);
    expect(romans.series[3].units).toBe(14);
    // At a turn where romans was NOT the tracked player, no faction-scoped
    // treasury exists in a timeline row → stays null (no fabrication).
    expect(romans.series[1].treasury).toBe(null);
    // carthage was tracked at turn 3 → its treasury/units are present there.
    const carthage = r.factions.find((f) => f.faction === "carthage");
    expect(carthage.series[2].treasury).toBe(300);
    expect(carthage.series[2].units).toBe(2);
  });

  test("settlements are 0 (not null) when a row has ownership data but the faction is absent", () => {
    const r = analyzeCampaign(campaignRows());
    const carthage = r.factions.find((f) => f.faction === "carthage");
    // Turns 4 and 5: other factions own settlements, carthage owns none → 0.
    expect(carthage.series[3].settlements).toBe(0);
    expect(carthage.series[4].settlements).toBe(0);
  });

  test("no ownership data in a row → settlements null (unknown), not fabricated 0", () => {
    const rows = [
      { turn: 1, _ownerByCity: { a: "romans", b: "gauls" } },
      { turn: 2, _ownerByCity: {} }, // undecoded ownership
    ];
    const r = analyzeCampaign(rows);
    const romans = r.factions.find((f) => f.faction === "romans");
    expect(romans.series[0].settlements).toBe(1);
    expect(romans.series[1].settlements).toBe(null);
  });

  test("a temporary dip that recovers to peak is NOT a decline", () => {
    const rows = [
      { turn: 1, _ownerByCity: ownerMap({ romans: 5, gauls: 1 }) },
      { turn: 2, _ownerByCity: ownerMap({ romans: 3, gauls: 1 }) }, // dip
      { turn: 3, _ownerByCity: ownerMap({ romans: 5, gauls: 1 }) }, // recovers to peak
    ];
    const romans = analyzeCampaign(rows).factions.find((f) => f.faction === "romans");
    expect(romans.firstDecline).toBe(null);
    expect(romans.peak).toEqual({ turn: 1, settlements: 5 });
  });

  test("accepts a full crackSave-shaped row (ownerByCity + factions + units array)", () => {
    // Not a timeline row — a cracked-save shape. summarizeForCompare fills every
    // faction's treasury/units here (units is an ARRAY, treasury under .factions).
    const rows = [
      {
        turn: 1,
        ownerByCity: { Rome: "romans", Carthage: "carthage" },
        factions: { romans: { treasury: 900 }, carthage: { treasury: 1500 } },
        units: [{ faction: "romans", soldiers: 100 }, { faction: "carthage", soldiers: 200 }],
      },
      {
        turn: 2,
        ownerByCity: { Rome: "romans", Arretium: "romans", Carthage: "carthage" },
        factions: { romans: { treasury: 1300 }, carthage: { treasury: 1100 } },
        units: [{ faction: "romans", soldiers: 150 }],
      },
    ];
    const r = analyzeCampaign(rows);
    const romans = r.factions.find((f) => f.faction === "romans");
    const carthage = r.factions.find((f) => f.faction === "carthage");
    expect(romans.series[1].settlements).toBe(2);
    expect(romans.series[0].treasury).toBe(900);   // per-faction, from .factions
    expect(carthage.series[0].treasury).toBe(1500); // non-player faction too
    expect(romans.series[1].units).toBe(1);         // unit-array count
    expect(r.winner).toBe("romans");
  });
});
