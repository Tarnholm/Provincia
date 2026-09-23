// Captain-led land armies in live mode (main.js parseCharactersAndUnits).
//
// A captain army has a type-5 position record (a named general's is type 6);
// its id sits 20 bytes before its FIRST unit record, the army's other units
// carry 0xffffffff there, and every one of them has commander 0. The file-order
// pass used to hand those units to whichever general preceded them, so the
// captain army vanished from the map and an unrelated general grew.
//
// Ground truth from the running game (RTWHook, 2026-09-23), after one AI turn
// of a RIS campaign — the save the game wrote at that moment:
//   1,214 land armies, 262 of them led by a captain;
//   Captain Yahua (carthage) at (283,343) with 10 infantry, next to Hanno (283,344).
// Needs the local fixture scripts/save-fixtures/feral/ris_t2_captains.sav
// (saves are gitignored) and the RIS mod.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const SAVE = path.join(__dirname, "..", "scripts", "save-fixtures", "feral", "ris_t2_captains.sav");
const MOD = "C:/RIS/RIS/data";
const have = fs.existsSync(SAVE) && fs.existsSync(MOD + "/descr_sm_factions.txt");

describe.skipIf(!have)("captain-led armies (engine-measured save)", () => {
  let land;
  it("parses", () => {
    const H = require("./mainIpcHarness.js").loadMainHandlers();
    H.main.loadModCharacterData(MOD);
    land = H.main.parseCharactersAndUnits(fs.readFileSync(SAVE)).liveArmies.filter((a) => a.armyClass !== "navy");
    expect(land.length).toBeGreaterThan(0);
  });

  it("finds every land army the engine had", () => {
    expect(land.length).toBe(1214);
  });

  it("keeps a captain's units in the captain's own army", () => {
    const yahua = land.find((a) => a.x === 283 && a.y === 343);
    expect(yahua).toBeTruthy();
    expect(yahua.units.length).toBe(10);
    const hanno = land.find((a) => a.x === 283 && a.y === 344);
    expect(hanno.units.length).toBe(1); // his bodyguard only — not Yahua's infantry
  });
});
