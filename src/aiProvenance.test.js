// @vitest-environment node
//
// Whether a log and a save describe the same moment.
//
// This exists because the reference pairing does NOT: the log covers turns 1-51 and
// the save is turn 102, so every "the army never arrived" verdict was decided against
// a world 51 turns further on. That was only noticed because two sources disagreed
// about the rebel faction's size and both numbers survived scrutiny.
import { describe, it, expect } from "vitest";
import { logStartsAtCampaignStart, logSaveAlignment, sameCampaignCheck, provenanceLeads, parseCampaignStartYear } from "./aiProvenance.js";

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
  // RIS runs FOUR turns per year. The log's season field only ever reads summer or
  // winter, so counting (year, season) blocks gives 2 per year and undercounts turns by
  // 2x. An earlier version did exactly that: it called the 26-year reference log "51
  // turns", put the turn-102 save 51 turns beyond it, and reported a gap that does not
  // exist. Comparison is therefore done in YEARS, which every faction header states.
  it("places the reference save INSIDE the log's span", () => {
    // The real numbers: log -270..-245, save turn 102, 4 turns/year -> year ~-245.
    const a = logSaveAlignment({ firstYear: -270, lastYear: -245, saveTurn: 102, startsAtTurn1: true });
    expect(a.logYears).toBe(26);
    expect(a.turnsPerYear).toBe(4);
    expect(a.overlaps).toBe(true);
    expect(a.confidence).toBe("good");
    // No lead: there is nothing to warn about, and a caveat that always fires is noise.
    expect(provenanceLeads(a)).toHaveLength(0);
  });

  it("would have reported a false gap at the wrong timescale", () => {
    // Pinning the bug itself. At 2 turns/year the same save lands ~25 years past the
    // log's end and the check screams; at 4 it is inside. The timescale is the whole
    // difference between a real finding and a phantom one.
    const wrong = logSaveAlignment({ firstYear: -270, lastYear: -245, saveTurn: 102, startsAtTurn1: true, turnsPerYear: 2 });
    expect(wrong.overlaps).toBe(false);
    // 25.5 years past a 26-year log — a hair under the "as long again" threshold, so
    // "fair" rather than "poor". Either way it invents a ~25-year gap that is not there,
    // and it would have emitted a caveat over every cross-referenced finding.
    expect(wrong.confidence).toBe("fair");
    expect(wrong.gapYears).toBeGreaterThan(20);
    expect(provenanceLeads(wrong).length).toBe(1);
    const right = logSaveAlignment({ firstYear: -270, lastYear: -245, saveTurn: 102, startsAtTurn1: true, turnsPerYear: 4 });
    expect(right.overlaps).toBe(true);
  });

  it("flags a save genuinely far past the log", () => {
    const a = logSaveAlignment({ firstYear: -270, lastYear: -260, saveTurn: 300, startsAtTurn1: true });
    expect(a.overlaps).toBe(false);
    expect(a.confidence).toBe("poor");
    expect(a.note).toMatch(/longer than the log itself/);
    expect(provenanceLeads(a)).toHaveLength(1);
  });

  it("calls a small overshoot fair, not poor", () => {
    const a = logSaveAlignment({ firstYear: -270, lastYear: -260, saveTurn: 52, startsAtTurn1: true });
    expect(a.confidence).toBe("fair");
  });

  it("refuses to compute a gap when the log is not anchored to turn 1", () => {
    const a = logSaveAlignment({ firstYear: -270, lastYear: -245, saveTurn: 102, startsAtTurn1: false });
    expect(a.gapYears).toBeNull();
    expect(a.confidence).toBe("unknown");
    expect(a.note).toMatch(/cannot be established/);
  });

  it("says nothing without the years or the turn", () => {
    expect(logSaveAlignment({ saveTurn: 102 })).toBeNull();
    expect(logSaveAlignment({ firstYear: -270, lastYear: -245 })).toBeNull();
  });
});

describe("sameCampaignCheck", () => {
  const fh = (m) => Object.fromEntries(Object.entries(m).map(([f, [last, peak]]) =>
    [f, { lastSettlements: last, maxSeenSettlements: peak }]));

  it("EXCLUDES the rebel faction — the mistake this check first made", () => {
    // Its first version fired on exactly one faction, the rebels: log ~31 settlements
    // against 522 in the save, and it declared "different campaigns". Once the
    // timescale was corrected the save turned out to sit INSIDE the log's span, so at
    // the same moment two figures 17x apart mean the sources are not measuring the same
    // thing for that faction — not that the campaigns differ. aiExpansion.js already
    // excludes the rebels for the same reason.
    const r = sameCampaignCheck({
      factionHealth: fh({ slave: [31, 413], carthage: [43, 43] }),
      saveCounts: { slave: 522, carthage: 48 },
    });
    expect(r.contradictions).toHaveLength(0);
    expect(r.sameCampaign).toBe(true);
  });

  it("needs TWO or more factions before calling it a different campaign", () => {
    // One faction diverging is more likely a quirk of that faction's numbers than
    // proof of two playthroughs.
    const one = sameCampaignCheck({
      factionHealth: fh({ a: [10, 40], b: [40, 40] }),
      saveCounts: { a: 300, b: 44 },
    });
    expect(one.contradictions).toHaveLength(1);
    expect(one.sameCampaign).toBe(true);           // not enough to conclude
    expect(one.singleOutlier.faction).toBe("a");   // but reported, not hidden
    expect(provenanceLeads(null, one)).toHaveLength(0);

    const two = sameCampaignCheck({
      factionHealth: fh({ a: [10, 40], b: [12, 50] }),
      saveCounts: { a: 300, b: 260 },
    });
    expect(two.contradictions).toHaveLength(2);
    expect(two.sameCampaign).toBe(false);
    expect(provenanceLeads(null, two)).toHaveLength(1);
  });

  it("does not flag ordinary growth over a long campaign", () => {
    const r = sameCampaignCheck({
      factionHealth: fh({ a: [40, 40], b: [90, 95], c: [26, 26] }),
      saveCounts: { a: 48, b: 101, c: 33 },
    });
    expect(r.sameCampaign).toBe(true);
    expect(r.contradictions).toHaveLength(0);
  });

  it("ignores small absolute counts where a large ratio is unremarkable", () => {
    const r = sameCampaignCheck({ factionHealth: fh({ tiny: [2, 3] }), saveCounts: { tiny: 12 } });
    expect(r.sameCampaign).toBe(true);
  });

  it("gives no verdict without both sides", () => {
    expect(sameCampaignCheck({ factionHealth: fh({ a: [1, 1] }) })).toBeNull();
    expect(sameCampaignCheck({ saveCounts: { a: 1 } })).toBeNull();
  });
});

describe("campaign start year anchoring", () => {
  // The crash reporter ships a TAIL of the campaign log (recent turn blocks only), so a
  // tester's extract NEVER opens at turn 1. Anchoring on "the log starts at the campaign
  // start" therefore fails for every real report: on the first one analysed the check
  // could only answer "unknown", and it reported a save year 14 years wrong because it
  // assumed the log's first year was the campaign's. descr_strat states the start year
  // outright, which removes the guess entirely.
  it("reads start_date out of descr_strat", () => {
    // Built with String.fromCharCode so no editor or patch script can turn the
    // escape sequences into real whitespace - which is exactly what happened while
    // writing this test, producing an unterminated string literal.
    const TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
    const strat = "campaign" + TAB + "imperial_campaign" + NL
      + "start_date" + TAB + "-270 summer" + NL
      + "end_date" + TAB + "14 summer";
    expect(parseCampaignStartYear(strat)).toBe(-270);
    expect(parseCampaignStartYear("start_date  -270 summer")).toBe(-270);
    expect(parseCampaignStartYear("no such line")).toBeNull();
    expect(parseCampaignStartYear(null)).toBeNull();
  });

  it("places a TAIL extract correctly against the save", () => {
    // The real numbers from the first full tester report (Leo, Bithynia): the log covers
    // -256..-254 and the save is turn 69. At 4 turns/year from -270 that is year -253 —
    // one year past the log's end, i.e. the same period. Without the anchor this same
    // input yields "unknown" and a saveYear of -239.
    const a = logSaveAlignment({ firstYear: -256, lastYear: -254, saveTurn: 69, campaignStartYear: -270 });
    expect(a.anchoredBy).toBe("descr_strat start_date");
    expect(a.saveYear).toBe(-253);
    expect(a.overlaps).toBe(true);
    expect(a.confidence).toBe("good");
    expect(provenanceLeads(a)).toHaveLength(0);
  });

  it("still flags a save genuinely outside a tail extract's span", () => {
    // The anchor must not turn the check into a rubber stamp: a save far past the tail
    // is still a bad pairing.
    const a = logSaveAlignment({ firstYear: -256, lastYear: -254, saveTurn: 200, campaignStartYear: -270 });
    expect(a.overlaps).toBe(false);
    expect(a.confidence).toBe("poor");
    expect(provenanceLeads(a)).toHaveLength(1);
  });

  it("flags a save from BEFORE the log's window", () => {
    const a = logSaveAlignment({ firstYear: -240, lastYear: -238, saveTurn: 5, campaignStartYear: -270 });
    expect(a.overlaps).toBe(false);
    expect(a.note).toMatch(/before the log begins/);
  });

  it("falls back to the turn-1 anchor when descr_strat is unavailable", () => {
    const a = logSaveAlignment({ firstYear: -270, lastYear: -245, saveTurn: 102, startsAtTurn1: true });
    expect(a.anchoredBy).toBe("log opens at turn 1");
    expect(a.overlaps).toBe(true);
  });

  it("refuses a verdict with neither anchor", () => {
    const a = logSaveAlignment({ firstYear: -256, lastYear: -254, saveTurn: 69, startsAtTurn1: false });
    expect(a.anchoredBy).toBeNull();
    expect(a.saveYear).toBeNull();   // never a computed year off a guessed anchor
    expect(a.confidence).toBe("unknown");
  });
});
