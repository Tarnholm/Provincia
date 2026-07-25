// Campaign OUTCOME — start ownership vs save ownership. The rest of the Lab
// measures attempts; this measures whether any of them worked.
//
// The load-bearing behaviours: the independent-peoples faction is excluded from
// the "real factions" arithmetic (RIS gives it most of the map on purpose, so its
// size is not a finding — only its delta is), and the comparison REFUSES itself
// when the two populations don't match closely enough to be differenced.
import { describe, it, expect } from "vitest";
import { expansionReport, expansionLeads, DEFAULT_REBEL } from "./aiExpansion.js";

// a tiny world: 10 settlements, 3 real factions + the independents
const startCounts = { slave: 5, rome: 3, carthage: 1, epirus: 1 };
const ownerNow = {
  // slave lost one to rome, epirus was wiped out by carthage
  S1: "slave", S2: "slave", S3: "slave", S4: "slave",
  R1: "rome", R2: "rome", R3: "rome", R4: "slave",
  C1: "carthage", C2: "carthage",
};

describe("expansionReport", () => {
  it("counts each faction's before and after, and the net for real factions", () => {
    const r = expansionReport({ startCounts, nowOwnerByCity: ownerNow });
    expect(r.startTotal).toBe(10);
    expect(r.nowTotal).toBe(10);
    expect(r.comparable).toBe(true);
    expect(r.rebelFaction).toBe("slave");
    expect(r.rebelBefore).toBe(5);
    expect(r.rebelAfter).toBe(5);      // lost R4's… no: gained one, lost one
    expect(r.factions).toBe(3);        // rome, carthage, epirus — NOT slave
    const byFac = Object.fromEntries(r.rows.map((x) => [x.faction, x]));
    expect(byFac.rome).toMatchObject({ before: 3, after: 3, delta: 0 });
    expect(byFac.carthage).toMatchObject({ before: 1, after: 2, delta: 1 });
    expect(byFac.epirus).toMatchObject({ before: 1, after: 0, delta: -1 });
    expect(r.netNonRebel).toBe(0);
  });

  it("excludes the independents from the real-faction tallies entirely", () => {
    const r = expansionReport({ startCounts, nowOwnerByCity: ownerNow });
    expect(r.rows.some((x) => x.faction === "slave")).toBe(false);
    // …but still reports its own delta, which IS the interesting number
    expect(r).toHaveProperty("rebelDelta");
  });

  it("identifies wiped-out factions", () => {
    const r = expansionReport({ startCounts, nowOwnerByCity: ownerNow });
    expect(r.wipedOut).toBe(1);
    expect(r.wipedOutNames).toEqual(["epirus"]);
  });

  it("REFUSES to compare when the two populations do not match", () => {
    // save has far fewer settlements than descr_strat — differencing them would
    // manufacture losses that are really just missing data
    const r = expansionReport({ startCounts, nowOwnerByCity: { A: "rome", B: "slave" } });
    expect(r.comparable).toBe(false);
    expect(r.divergencePct).toBeGreaterThan(2);
    // the numbers are still returned for inspection — just flagged as unsound
    expect(r.startTotal).toBe(10);
    expect(r.nowTotal).toBe(2);
  });

  it("tolerates a small divergence, since settlements can be founded or razed", () => {
    const now = { ...ownerNow };
    delete now.C2;                                     // 10 -> 9, a 10% drop
    expect(expansionReport({ startCounts, nowOwnerByCity: now }).comparable).toBe(false);
    // widen the tolerance and it becomes comparable — the knob works
    expect(expansionReport({ startCounts, nowOwnerByCity: now, tolerancePct: 15 }).comparable).toBe(true);
  });

  it("returns null rather than guessing when a side is missing", () => {
    expect(expansionReport({ startCounts })).toBeNull();
    expect(expansionReport({ nowOwnerByCity: ownerNow })).toBeNull();
    expect(expansionReport()).toBeNull();
    expect(expansionReport({ startCounts: {}, nowOwnerByCity: ownerNow })).toBeNull();
  });

  it("uses the engine's independent faction by default", () => {
    expect(DEFAULT_REBEL).toBe("slave");
    // and honours an override, for a mod that renames it
    const r = expansionReport({ startCounts: { rebels: 4, rome: 1 }, nowOwnerByCity: { A: "rebels", B: "rebels", C: "rebels", D: "rebels", E: "rome" }, rebelFaction: "rebels" });
    expect(r.rebelFaction).toBe("rebels");
    expect(r.factions).toBe(1);
  });
});

describe("expansionLeads", () => {
  it("fires when the independents did not lose ground", () => {
    // slave 5 -> 6: conquest is going backwards
    const r = expansionReport({
      startCounts,
      nowOwnerByCity: { ...ownerNow, C1: "slave" },
    });
    const [lead] = expansionLeads(r);
    expect(lead).toBeTruthy();
    expect(lead.severity).toBe(3);
    expect(lead.faction).toBe("all (campaign outcome)");
    expect(lead.issue).toMatch(/CONQUEST IS NOT WORKING/);
    expect(lead.issue).toMatch(/went from 5 settlements to 6/);
    expect(lead.suggestion).toMatch(/re-measure it after any change/);
  });

  it("fires when a large share of the roster is gone, even if the independents shrank", () => {
    // slave 5 -> 3 (lost ground) but 2 of 3 real factions wiped out
    const r = expansionReport({
      startCounts,
      nowOwnerByCity: { A: "slave", B: "slave", C: "slave", D: "rome", E: "rome", F: "rome", G: "rome", H: "rome", I: "rome", J: "rome" },
    });
    expect(r.rebelDelta).toBeLessThan(0);
    expect(r.wipedOut).toBe(2);
    expect(expansionLeads(r)).toHaveLength(1);
  });

  it("stays quiet when conquest IS working and the roster is intact", () => {
    // slave 5 -> 2, nobody wiped out
    const r = expansionReport({
      startCounts,
      nowOwnerByCity: { A: "slave", B: "slave", C: "rome", D: "rome", E: "rome", F: "rome", G: "rome", H: "carthage", I: "carthage", J: "epirus" },
    });
    expect(r.rebelDelta).toBe(-3);
    expect(r.wipedOut).toBe(0);
    expect(expansionLeads(r)).toEqual([]);
  });

  it("never publishes a lead from an incomparable report", () => {
    const r = expansionReport({ startCounts, nowOwnerByCity: { A: "slave" } });
    expect(r.comparable).toBe(false);
    expect(expansionLeads(r)).toEqual([]);
    expect(expansionLeads(null)).toEqual([]);
  });
});
