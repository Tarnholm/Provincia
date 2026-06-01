// src/nonLiveCommanderResolver.test.js
//
// REGRESSION GUARD for the NON-LIVE / starting-state commander-card portrait
// bug: the starting royal family (Quintus / Marcus / Servius Ogulnius_Gallus,
// romans_julii) rendered DJB2 hash-pool faces (110/020/058.tga) on their
// field/garrison commander cards, because resolveNonLiveCommanderInfo resolved
// the portrait ONLY from statsCache (which carried the stat row but no portrait
// for these chars) and never consulted the engine-exact coord map the FAMILY
// TREE uses (v1PortraitsByCoord). The fix folds v1PortraitsByCoord + descr_strat
// char coords + statsCache into one map and consults it FIRST.
//
// This test exercises the SHARED resolver the UI + headless doctor both use,
// against a real RIS julii save fixture. Skips when the save/mod is absent.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import {
  buildNonLivePortraitMap,
  resolveNonLiveCommanderInfo,
} from "./nonLiveCommanderResolver.js";
import { crackSave } from "./saveCracker.js";

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_julii1.sav";
const MOD = "C:\\RIS\\RIS\\data";

function loadIfPresent(p) { try { return fs.readFileSync(p); } catch { return null; } }

const buf = loadIfPresent(SAVE);
const haveFixture = !!buf && fs.existsSync(MOD);
const describeIf = haveFixture ? describe : describe.skip;

// The starting Julii royal family — the exact chars from the bug report.
const ROYALS = [
  { fn: "Quintus", ln: "Ogulnius_Gallus", coord: "285,404" },
  { fn: "Marcus", ln: "Ogulnius_Gallus", coord: "283,402" },
  { fn: "Servius", ln: "Ogulnius_Gallus", coord: "282,404" },
];
const FAC = "romans_julii";
const HASH_POOL_FILES = ["110.tga", "020.tga", "058.tga"]; // the wrong faces

// Build the engine-exact v1 coord→portrait map from the crack (the SAME pick +
// /cards/ rewrite as main.js's v1PortraitsByCoord builder), plus the descr_strat
// starting-char list with coords (firstName/lastName/faction/x/y).
function buildSources() {
  const r = crackSave(buf, MOD);
  const v1ByCoord = {};
  const startingChars = [];
  for (const c of r.characters.v1) {
    if (c.isDead) continue;
    if (c.tileX == null || c.tileY == null) continue;
    const ports = Array.isArray(c.portraits) ? c.portraits : [];
    const isBad = (p) => !p || (!c.isDead && /\/dead\//i.test(p));
    const gl = ports.find((p) => !isBad(p) && /\/portraits\/portraits\//i.test(p));
    const ga = ports.find((p) => !isBad(p));
    const pick = gl || ga;
    if (pick) v1ByCoord[`${c.tileX},${c.tileY}`] = pick.replace(/\/portraits\/portraits\//i, "/portraits/cards/");
    if (c.firstName) startingChars.push({ firstName: c.firstName, lastName: c.lastName || null, faction: c.faction || FAC, x: c.tileX, y: c.tileY });
  }
  return { v1ByCoord, startingChars };
}

describeIf("nonLiveCommanderResolver — starting royal family (julii1 fixture)", () => {
  // crackSave is heavy (~5-10s) — run it ONCE for the whole describe block.
  let v1ByCoord, startingChars, map;
  beforeAll(() => {
    ({ v1ByCoord, startingChars } = buildSources());
    map = buildNonLivePortraitMap(v1ByCoord, startingChars, null);
  }, 60000);

  it("each royal resolves a REAL engine-exact portrait (not the hash pool)", () => {
    for (const royal of ROYALS) {
      const info = resolveNonLiveCommanderInfo(royal.fn, royal.ln, FAC, null, startingChars, map);
      expect(info, `${royal.fn} should resolve to an info object`).toBeTruthy();
      expect(info.savePath, `${royal.fn} must resolve a real portrait, not null (hash pool)`).toBeTruthy();
      // It must be the COORD-keyed engine-exact portrait the family tree shows.
      expect(info.savePath).toBe(v1ByCoord[royal.coord]);
      // And NOT one of the wrong hash-pool faces from the bug.
      const base = String(info.savePath).replace(/^.*[\\/]/, "").toLowerCase();
      expect(HASH_POOL_FILES).not.toContain(base);
    }
  });

  it("OLD behavior (no portraitMap, no statsCache) returned null savePath — the bug", () => {
    // Reproduce the pre-fix resolution: statsCache-only (null here) with NO
    // engine-exact map. Every royal falls to null savePath → renderer hash pool.
    for (const royal of ROYALS) {
      const info = resolveNonLiveCommanderInfo(royal.fn, royal.ln, FAC, null, startingChars, null);
      // The resolver still returns an info object (it has a name), but with no
      // portrait — which is exactly what made the renderer hash-pool the face.
      expect(info && info.savePath, `${royal.fn} (old path) should have NO portrait`).toBeFalsy();
    }
  });

  it("a genuinely-unknown commander stays null (no fabricated face)", () => {
    const info = resolveNonLiveCommanderInfo("Nonexistus", "Madeupname", FAC, null, startingChars, map);
    // No coord, no name-key, no statsCache → null savePath (respects no-fallback).
    expect(info ? info.savePath : null).toBeFalsy();
  });
});
