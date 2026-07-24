// Before/after harness — digest + diff. The important behaviours here are the
// ones that stop a comparison LYING: a shorter campaign must not read as an
// improvement, and mismatched log kinds must be refused outright.
import { describe, it, expect } from "vitest";
import { makeDigest, diffDigests } from "./aiRunDigest.js";

// Minimal stand-in for an analysis result, shaped like the real one.
function fakeResult({ turns = 50, stalls = 0, orphans = 0, impossible = 0, faction = "epirus", kind = "campaign_ai", leads = 0, save = true } = {}) {
  const findings = [];
  for (let i = 0; i < stalls; i++) findings.push({ kind: "campaign_stall", faction, detail: "x", impossible: i < impossible, verdict: i < impossible ? "NEVER arrived — x" : "" });
  for (let i = 0; i < orphans; i++) findings.push({ kind: "abandoned", faction, detail: "x", orphaned: true, verdict: "ORPHANED — x" });
  return {
    logKind: kind, totalTurns: turns, lines: 1000, logPath: "L", logBytes: 10,
    findings,
    findingCounts: { campaign_stall: stalls, abandoned: orphans },
    modLeads: Array.from({ length: leads }, () => ({ file: "feral_descr_ai_personality.txt" })),
    economy: { [faction]: { reports: 10, richPct: 0.5, poorPct: 0.2 } },
    save: save ? { turn: 102, confirmedNeverArrived: impossible, impossibleCampaigns: impossible, orphanedArmies: orphans, navalWorld: 50, factionsWithUnits: 125 } : null,
  };
}

describe("makeDigest", () => {
  it("captures a compact, JSON-safe snapshot", () => {
    const d = makeDigest(fakeResult({ stalls: 10, orphans: 4, impossible: 6, leads: 3 }), { label: "before", savedAt: "2026-07-25T00:00:00Z" });
    expect(d.label).toBe("before");
    expect(d.findings).toBe(14);
    expect(d.byKind.campaign_stall).toBe(10);
    expect(d.byKind.abandoned).toBe(4);
    expect(d.byFaction.epirus).toMatchObject({ total: 14, impossible: 6, orphaned: 4 });
    expect(d.leads).toBe(3);
    expect(d.leadsByFile["feral_descr_ai_personality.txt"]).toBe(3);
    expect(d.save.turn).toBe(102);
    expect(d.economySummary).toMatchObject({ factions: 1, avgRichPct: 0.5 });
    expect(() => JSON.parse(JSON.stringify(d))).not.toThrow(); // must survive disk round-trip
  });

  it("returns null for an errored or empty run", () => {
    expect(makeDigest(null)).toBeNull();
    expect(makeDigest({ error: "boom" })).toBeNull();
  });
});

describe("diffDigests", () => {
  it("calls a genuine reduction an improvement", () => {
    const before = makeDigest(fakeResult({ turns: 50, stalls: 100, impossible: 40, orphans: 20, leads: 10 }), { label: "before" });
    const after = makeDigest(fakeResult({ turns: 50, stalls: 50, impossible: 10, orphans: 5, leads: 4 }), { label: "after" });
    const d = diffDigests(before, after);
    expect(d.comparable).toBe(true);
    expect(d.caveat).toBeNull();
    expect(d.verdict).toBe("improved");
    expect(d.byKind.campaign_stall.delta).toBe(-50);
    expect(d.save.impossible.delta).toBe(-30);
    expect(d.save.orphaned.delta).toBe(-15);
    expect(d.leads.delta).toBe(-6);
    expect(d.factionRows[0].faction).toBe("epirus");
    expect(d.factionRows[0].total).toBeLessThan(0);
  });

  it("calls an increase a regression", () => {
    const before = makeDigest(fakeResult({ turns: 50, stalls: 20 }), { label: "before" });
    const after = makeDigest(fakeResult({ turns: 50, stalls: 60 }), { label: "after" });
    expect(diffDigests(before, after).verdict).toBe("regressed");
  });

  it("does NOT let a shorter campaign fake an improvement", () => {
    // half the turns, half the findings → identical RATE, so not an improvement
    const before = makeDigest(fakeResult({ turns: 100, stalls: 100 }), { label: "before" });
    const after = makeDigest(fakeResult({ turns: 50, stalls: 50 }), { label: "after" });
    const d = diffDigests(before, after);
    expect(d.byKind.campaign_stall.delta).toBe(-50);        // raw count fell...
    expect(d.byKind.campaign_stall.ratePct).toBe(0);        // ...but the rate didn't
    expect(d.comparable).toBe(false);                        // spans differ too much
    expect(d.caveat).toMatch(/campaign lengths differ/);
    expect(d.verdict).toBe("inconclusive");                  // refuses to claim a win
  });

  it("refuses to compare different log kinds", () => {
    const before = makeDigest(fakeResult({ kind: "campaign_ai", stalls: 10 }), { label: "before" });
    const after = makeDigest(fakeResult({ kind: "message_log", stalls: 2 }), { label: "after" });
    const d = diffDigests(before, after);
    expect(d.comparable).toBe(false);
    expect(d.caveat).toMatch(/different log kinds/);
    expect(d.verdict).toBe("inconclusive");
  });

  it("reports 'unchanged' for noise-level movement", () => {
    const before = makeDigest(fakeResult({ turns: 50, stalls: 100 }), { label: "before" });
    const after = makeDigest(fakeResult({ turns: 50, stalls: 97 }), { label: "after" }); // -3%
    expect(diffDigests(before, after).verdict).toBe("unchanged");
  });

  it("needs two runs", () => {
    expect(diffDigests(null, {}).error).toMatch(/two runs/);
  });
});
