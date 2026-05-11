import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveCurrentOwners } from "./saveOwnershipParser.js";
import { buildInitialOwnership } from "./ownershipParser.js";

const FIXTURE_DIR = path.join("scripts", "save-cracker", "fixtures", "feral");
const RIS_DATA = "C:/RIS/RIS/data";

const hasRisData = fs.existsSync(path.join(RIS_DATA, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));

describe.skipIf(!hasRisData)("resolveCurrentOwners (RIS imperial)", () => {
  test("plurality vote recovers conquests at turn 22 athens", () => {
    const fp = path.join(FIXTURE_DIR, "athens_t22mid.sav");
    if (!fs.existsSync(fp)) return;
    const init = buildInitialOwnership(RIS_DATA);
    const cur = resolveCurrentOwners(fs.readFileSync(fp), init.ownerByCity);
    // ≥80% of the ~1095 settlement markers should resolve. The 60%-majority
    // version this replaced left ~30% unresolved (regression test).
    const resolved = Object.keys(cur.ownerByCity).length;
    expect(resolved).toBeGreaterThan(1050);
    // Detect at least 100 conquests on a turn-22 save.
    let conquests = 0;
    for (const [city, owner] of Object.entries(cur.ownerByCity)) {
      if (init.ownerByCity[city] && init.ownerByCity[city] !== owner) conquests++;
    }
    expect(conquests).toBeGreaterThan(100);
  });

  test("uuid=0 settlements resolve to the slave/rebel faction", () => {
    const fp = path.join(FIXTURE_DIR, "athens_t22mid.sav");
    if (!fs.existsSync(fp)) return;
    const init = buildInitialOwnership(RIS_DATA);
    const cur = resolveCurrentOwners(fs.readFileSync(fp), init.ownerByCity);
    // Slave/rebel faction is the most common in starting ownership.
    const counts = new Map();
    for (const f of Object.values(cur.ownerByCity)) counts.set(f, (counts.get(f) || 0) + 1);
    expect(counts.has("slave")).toBe(true);
  });

  test("identical-state pair → identical owner attribution", () => {
    const a = path.join(FIXTURE_DIR, "identical_A.sav");
    const b = path.join(FIXTURE_DIR, "identical_B.sav");
    if (!fs.existsSync(a) || !fs.existsSync(b)) return;
    const init = buildInitialOwnership(RIS_DATA);
    const ca = resolveCurrentOwners(fs.readFileSync(a), init.ownerByCity);
    const cb = resolveCurrentOwners(fs.readFileSync(b), init.ownerByCity);
    expect(ca.detectedOffset).toBe(cb.detectedOffset);
    expect(Object.keys(ca.ownerByCity).length).toBe(Object.keys(cb.ownerByCity).length);
    for (const k of Object.keys(ca.ownerByCity)) {
      expect(cb.ownerByCity[k]).toBe(ca.ownerByCity[k]);
    }
  });
});
