import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { resolveCurrentOwners } from "./saveOwnershipParser.js";
import { buildInitialOwnership } from "./ownershipParser.js";
const require = createRequire(import.meta.url);
const { fixture, fixtures, read } = require("./saveFixtures.js");

const RIS_DATA = "C:/RIS/RIS/data";
const hasRisData = fs.existsSync(path.join(RIS_DATA, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));

// These are the one place a fixture is compared against the LIVE mod, because
// recovering conquests needs a starting position to compare with. The fixtures
// are older than the mod, so the first test measures that drift and the
// conquest thresholds below sit far above it.
describe.skipIf(!hasRisData)("resolveCurrentOwners (against the installed mod)", () => {
  test("mod drift is small: a turn-1 save barely differs from today's starting position", (ctx) => {
    const f = fixture("identical_A.sav");
    if (!f) return ctx.skip();
    const init = buildInitialOwnership(RIS_DATA);
    const cur = resolveCurrentOwners(read(f), init.ownerByCity);
    let differs = 0, absent = 0;
    for (const [city, owner] of Object.entries(cur.ownerByCity)) {
      if (!init.ownerByCity[city]) absent++;
      else if (init.ownerByCity[city] !== owner) differs++;
    }
    // Turn 1: nothing has been conquered, so every difference is the mod having
    // moved since the save. Measured 2026-09-22: 2 differ, 7 absent of 1310.
    // If this ever climbs far, the fixture is too old to calibrate conquests.
    expect(differs).toBeLessThan(25);
    expect(absent).toBeLessThan(40);
  });

  test("plurality vote recovers conquests on a mid-campaign save", (ctx) => {
    const f = fixture("ror_t17s.sav");
    if (!f) return ctx.skip();
    const init = buildInitialOwnership(RIS_DATA);
    const cur = resolveCurrentOwners(read(f), init.ownerByCity);
    // ≥80% of the ~1300 settlement markers should resolve. The 60%-majority
    // version this replaced left ~30% unresolved (regression test).
    expect(Object.keys(cur.ownerByCity).length).toBeGreaterThan(1050);
    let conquests = 0;
    for (const [city, owner] of Object.entries(cur.ownerByCity)) {
      if (init.ownerByCity[city] && init.ownerByCity[city] !== owner) conquests++;
    }
    // Measured 250 at turn 17, against the drift floor of 2 above.
    expect(conquests).toBeGreaterThan(100);
  });

  test("uuid=0 settlements resolve to the slave/rebel faction", (ctx) => {
    const f = fixture("ror_t17s.sav");
    if (!f) return ctx.skip();
    const init = buildInitialOwnership(RIS_DATA);
    const cur = resolveCurrentOwners(read(f), init.ownerByCity);
    expect(Object.values(cur.ownerByCity)).toContain("slave");
  });

  test("identical-state pair → identical owner attribution", (ctx) => {
    const pair = fixtures("identical_A.sav", "identical_B.sav");
    if (!pair) return ctx.skip();
    const [a, b] = pair;
    expect(read(a).equals(read(b))).toBe(false); // same state, different bytes
    const init = buildInitialOwnership(RIS_DATA);
    const ca = resolveCurrentOwners(read(a), init.ownerByCity);
    const cb = resolveCurrentOwners(read(b), init.ownerByCity);
    expect(ca.detectedOffset).toBe(cb.detectedOffset);
    expect(Object.keys(ca.ownerByCity).length).toBe(Object.keys(cb.ownerByCity).length);
    for (const k of Object.keys(ca.ownerByCity)) {
      expect(cb.ownerByCity[k]).toBe(ca.ownerByCity[k]);
    }
  });
});
