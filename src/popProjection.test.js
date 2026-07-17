// Hermetic tests for the population-projection pure helpers (2026-07-17).
// No mod files, no IPC — the live RIS smoke ran at build-verification time
// (node -e projectPopulation on C:/RIS/RIS/data, romans_julii) and is NOT a
// test here: these pin the math (compound trajectory, tier-threshold parsing
// and crossing, risk-flag logic) so refactors fail a test instead of a session.
import { describe, it, expect } from "vitest";

const mod = await import("./popProjection.js");
const {
  parseTierTable, nextTierAt, compoundTrajectory, simulateTrajectory,
  firstReachTurn, riskFlags, TIER_ORDER, TIER_FALLBACK,
} = mod;

describe("parseTierTable", () => {
  // Synthetic descr_cultures snippet in the real file's shape (roman block,
  // RIS values) — comments and per-level ;labels included to pin the regexes.
  const SNIPPET = `
		"settlement upgrade levels":
		{
				;;the base population of this settlement before squalor kicks in
				"base": 400,	;village
				;;population needed to upgrade to this level
				"upgrade": 0,	;village
				"min pop": 400,	;village
				"base": 2000,	;town
				"upgrade": 1500,	;town
				"base": 4000,	;large town
				"upgrade": 4000,	;large town
				"base": 9000,	;city
				"upgrade": 9000,	;city
				"base": 14000,	;large city
				"upgrade": 17000,	;large city
				"base": 18000,	;huge city
				"upgrade": 27000,	;huge city
		}
`;
  it("reads the six upgrade thresholds in tier order", () => {
    const t = parseTierTable(SNIPPET);
    expect(t).not.toBeNull();
    expect(t.upgradeAt).toEqual({
      village: 0, town: 1500, large_town: 4000,
      city: 9000, large_city: 17000, huge_city: 27000,
    });
  });
  it("shifts squalor bases one tier down (growthEval.squalorBases convention)", () => {
    const t = parseTierTable(SNIPPET);
    expect(t.squalorBase).toEqual({
      village: 400, town: 400, large_town: 2000,
      city: 4000, large_city: 9000, huge_city: 14000,
    });
  });
  it("returns null on truncated input instead of a partial table", () => {
    expect(parseTierTable('"upgrade": 0, "base": 400')).toBeNull();
    expect(parseTierTable("")).toBeNull();
    expect(parseTierTable(null)).toBeNull();
  });
  it("fallback table matches the verified RIS values", () => {
    const t = parseTierTable(SNIPPET);
    expect(t).toEqual(TIER_FALLBACK);
  });
});

describe("nextTierAt", () => {
  it("returns the NEXT level's upgrade threshold", () => {
    expect(nextTierAt("village", TIER_FALLBACK)).toBe(1500);
    expect(nextTierAt("town", TIER_FALLBACK)).toBe(4000);
    expect(nextTierAt("large_city", TIER_FALLBACK)).toBe(27000);
  });
  it("is null at the top tier and for unknown levels", () => {
    expect(nextTierAt("huge_city", TIER_FALLBACK)).toBeNull();
    expect(nextTierAt("metropolis", TIER_FALLBACK)).toBeNull();
    expect(nextTierAt(null, TIER_FALLBACK)).toBeNull();
  });
});

describe("compoundTrajectory", () => {
  it("compounds a static rate with per-turn integer rounding", () => {
    // 1000 at +2%: 1020, 1040 (1020*1.02=1040.4→1040), 1061, ...
    expect(compoundTrajectory(1000, 2, 3)).toEqual([1020, 1040, 1061]);
  });
  it("handles zero and negative growth, clamping at 0", () => {
    expect(compoundTrajectory(500, 0, 3)).toEqual([500, 500, 500]);
    const down = compoundTrajectory(1000, -50, 12);
    expect(down[0]).toBe(500);
    expect(down.at(-1)).toBe(1);          // round-half-up floors the decay at 1 pop
    expect(down.every((v) => v >= 0)).toBe(true);
  });
  it("is deterministic", () => {
    expect(compoundTrajectory(1234, 1.5, 20)).toEqual(compoundTrajectory(1234, 1.5, 20));
  });
});

describe("simulateTrajectory", () => {
  it("matches compoundTrajectory under a constant growthFn with no tier table", () => {
    const { trajectory } = simulateTrajectory(1000, "town", 5, () => 2, null);
    expect(trajectory).toEqual(compoundTrajectory(1000, 2, 5));
  });
  it("tiers up when the post-growth pop crosses the next threshold, and growthFn sees the new level", () => {
    const seen = [];
    const growthFn = (pop, level) => { seen.push(level); return 10; };
    // 1400 town at +10%: 1540, 1694, 1863, 2050, ... crosses large_town's 4000?
    // Use village → town at 1500: pop 1400 → 1540 crosses on turn 1.
    const { trajectory, finalLevel } = simulateTrajectory(1400, "village", 3, growthFn, TIER_FALLBACK);
    expect(trajectory).toEqual([1540, 1694, 1863]);
    expect(seen).toEqual(["village", "town", "town"]); // upgraded after turn 1's growth
    expect(finalLevel).toBe("town");
  });
  it("tiers at most one level per turn even on a huge jump", () => {
    const { finalLevel } = simulateTrajectory(1400, "village", 1, () => 400, TIER_FALLBACK); // 1400→7000
    expect(finalLevel).toBe("town"); // not large_town, despite 7000 > 4000
  });
  it("never yields negative population", () => {
    const { trajectory } = simulateTrajectory(100, "town", 10, () => -90, TIER_FALLBACK);
    expect(trajectory.every((v) => v >= 0)).toBe(true);
    expect(trajectory.at(-1)).toBe(0);
  });
  it("coerces an unknown starting level to town", () => {
    const seen = [];
    simulateTrajectory(1000, "bogus", 1, (p, l) => { seen.push(l); return 0; }, TIER_FALLBACK);
    expect(seen).toEqual(["town"]);
  });
});

describe("firstReachTurn", () => {
  it("returns the 1-based turn of the first crossing", () => {
    expect(firstReachTurn([100, 200, 300], 250)).toBe(3);
    expect(firstReachTurn([100, 200, 300], 100)).toBe(1);   // >= threshold counts
  });
  it("is null when never reached or threshold unknown", () => {
    expect(firstReachTurn([100, 200, 300], 400)).toBeNull();
    expect(firstReachTurn([100, 200, 300], null)).toBeNull();
    expect(firstReachTurn(null, 100)).toBeNull();
  });
});

describe("riskFlags", () => {
  it("flags negative growth as declining, not stalled", () => {
    expect(riskFlags(-0.5, 1000, [995, 990])).toEqual({ declining: true, stalled: false });
  });
  it("flags a trajectory that ends below today's pop as declining even at 0 nominal growth", () => {
    // Dynamic squalor can turn an initially-flat town negative later on.
    expect(riskFlags(0, 1000, [1000, 998, 990]).declining).toBe(true);
  });
  it("flags |growth| < 0.1 with a flat trajectory as stalled", () => {
    expect(riskFlags(0, 1000, [1000, 1000, 1000])).toEqual({ declining: false, stalled: true });
  });
  it("healthy growth is neither", () => {
    expect(riskFlags(1.5, 1000, [1015, 1030])).toEqual({ declining: false, stalled: false });
  });
  it("growth snapped to 0.5 steps means only exact 0 stalls", () => {
    expect(riskFlags(0.5, 1000, [1005, 1010]).stalled).toBe(false);
  });
});
