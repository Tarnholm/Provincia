// @vitest-environment node
//
// Whether a log and a save describe the same moment.
//
// This exists because the reference pairing does NOT: the log covers turns 1-51 and
// the save is turn 102, so every "the army never arrived" verdict was decided against
// a world 51 turns further on. That was only noticed because two sources disagreed
// about the rebel faction's size and both numbers survived scrutiny.
import { describe, it, expect } from "vitest";
import { logStartsAtCampaignStart, logSaveAlignment, provenanceLeads } from "./aiProvenance.js";

// Shaped like the analyser's real factionHealth output.
const health = (m) => Object.fromEntries(Object.entries(m).map(([f, n]) => [f, { firstSettlements: n }]));

describe("logStartsAtCampaignStart", () => {
  it("recognises a log that opens at the campaign's starting ownership", () => {
    const r = logStartsAtCampaignStart({
      factionHealth: health({ romans_julii: 26, carthage: 41, ptolemaic: 84 }),
      startCounts: { romans_julii: 26, carthage: 41, ptolemaic: 84 },
    });
    expect(r.startsAtTurn1).toBe(true);
    expect(r.matchShare).toBe(1);
  });

  it("tolerates a settlement or two of early drift", () => {
    // The engine reads these counts a few lines into the turn, by which point a
    // capture may already have landed — carthage really does read 43 against a
    // descr_strat 41 on the reference data.
    const r = logStartsAtCampaignStart({
      factionHealth: health({ a: 11, b: 20, c: 30, d: 40 }),
      startCounts: { a: 10, b: 20, c: 30, d: 40 },
    });
    expect(r.startsAtTurn1).toBe(true);
  });

  it("rejects a log that opens mid-campaign", () => {
    const r = logStartsAtCampaignStart({
      factionHealth: health({ a: 40, b: 2, c: 55, d: 9 }),
      startCounts: { a: 10, b: 20, c: 30, d: 40 },
    });
    expect(r.startsAtTurn1).toBe(false);
    expect(r.mismatches.length).toBeGreaterThan(0);
  });

  it("gives no verdict without both sources", () => {
    expect(logStartsAtCampaignStart({ factionHealth: health({ a: 1 }) })).toBeNull();
    expect(logStartsAtCampaignStart({ startCounts: { a: 1 } })).toBeNull();
    // Factions absent from one side cannot vote, so no overlap means no verdict —
    // rather than a vacuous 0% or 100%.
    expect(logStartsAtCampaignStart({
      factionHealth: health({ a: 5 }), startCounts: { zzz: 5 },
    })).toBeNull();
  });
});

describe("logSaveAlignment", () => {
  it("flags the reference pairing as poor", () => {
    // The real numbers. A 51-turn gap on a 51-turn log is the boundary case, and it
    // must land on the bad side: the save sits at twice the log's end.
    const a = logSaveAlignment({ logTurns: 51, saveTurn: 102, startsAtTurn1: true });
    expect(a.gapTurns).toBe(51);
    expect(a.confidence).toBe("poor");
    expect(a.note).toMatch(/longer than the log itself/);
    expect(provenanceLeads(a)).toHaveLength(1);
  });

  it("accepts a save inside the log's range", () => {
    const a = logSaveAlignment({ logTurns: 51, saveTurn: 40, startsAtTurn1: true });
    expect(a.overlaps).toBe(true);
    expect(a.confidence).toBe("good");
    // No lead: there is nothing to warn about, and a warning that always fires is noise.
    expect(provenanceLeads(a)).toHaveLength(0);
  });

  it("calls a small overshoot fair, not poor", () => {
    const a = logSaveAlignment({ logTurns: 51, saveTurn: 55, startsAtTurn1: true });
    expect(a.confidence).toBe("fair");
    expect(provenanceLeads(a)).toHaveLength(1);
  });

  it("refuses to compute a gap when the log's turn range is unknown", () => {
    // Without a turn-1 anchor only the log's LENGTH is known, not which turns it
    // covers. Reporting a gap from that would be arithmetic on an assumption.
    const a = logSaveAlignment({ logTurns: 51, saveTurn: 102, startsAtTurn1: false });
    expect(a.gapTurns).toBeNull();
    expect(a.confidence).toBe("unknown");
    expect(a.note).toMatch(/cannot be established/);
  });

  it("says nothing without both turn numbers", () => {
    expect(logSaveAlignment({ logTurns: 0, saveTurn: 102 })).toBeNull();
    expect(logSaveAlignment({ logTurns: 51, saveTurn: 0 })).toBeNull();
  });
});
