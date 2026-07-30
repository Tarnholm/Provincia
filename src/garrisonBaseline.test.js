// Tests for the save-anchored garrison baseline (user 2026-07-30: "the save is
// the starting point, and all edits past that should be added on top"). Real
// temp mod dir end-to-end: descr_regions + a real 4×4 TGA + descr_strat + EDU,
// so garrisonMenByCity exercises the actual tile-coord path, then the baseline
// snapshot/delta semantics on top.
import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { garrisonMenByCity } from "./poModel.js";
import { loadOrCreateBaseline, garrisonAdjust } from "./garrisonBaseline.js";

let modDir, stratPath, baseDir;

const STRAT = (units) => [
  "faction\tromans_julii, balanced smith",
  "character,\tFlavius Julius, named character, male, age 40, , x 1, y 2",
  "army",
  ...units.map(u => `unit\t\t${u}\t\t\texp 0 armour 0 weapon_lvl 0`),
  "",
].join("\r\n");

const EDU = [
  "type roman hastati",
  "category infantry",
  "class heavy",
  "soldiers 20, 0, 1.2",
  "stat_cost 1, 400, 100, 50, 60, 400",
  "",
  "type roman principes",
  "category infantry",
  "class heavy",
  "soldiers 30, 0, 1.2",
  "stat_cost 1, 500, 120, 50, 60, 500",
  "",
].join("\n");

// descr_regions block: [0] region, [1] city, [4] RGB, [5] attrs (both parsers'
// shapes: descrStratGeneral reads i+1/i+4; growthEval needs ≥6 block lines)
const REGIONS = [
  "my_region",
  "\tMy_Town",
  "\tlegion_name",
  "\tsymbol",
  "\t25 60 130",
  "\tfarm1, hidden_x",
  "",
].join("\n");

// 4×4 uncompressed 24bpp bottom-up TGA: region colour (25,60,130) everywhere,
// one BLACK settlement pixel at top-coords (col 1, yTop 1) → coords {x:1, y:2}
function writeTGA(p) {
  const W = 4, H = 4;
  const buf = Buffer.alloc(18 + W * H * 3);
  buf[2] = 2; buf.writeUInt16LE(W, 12); buf.writeUInt16LE(H, 14); buf[16] = 24; buf[17] = 0;
  for (let i = 0; i < W * H; i++) { const o = 18 + i * 3; buf[o] = 130; buf[o + 1] = 60; buf[o + 2] = 25; }
  // black pixel: top-row yTop=1 → storage row H-1-1=2 (bottom-up), col 1
  const o = 18 + (2 * W + 1) * 3; buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0;
  fs.writeFileSync(p, buf);
}

const bumpMtime = (p) => { const st = fs.statSync(p); fs.utimesSync(p, st.atime, new Date(st.mtimeMs + 2000)); };

beforeEach(() => {
  modDir = fs.mkdtempSync(path.join(os.tmpdir(), "garrbase-"));
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "garrbase-store-"));
  const campDir = path.join(modDir, "world", "maps", "campaign", "imperial_campaign");
  const baseMap = path.join(modDir, "world", "maps", "base");
  fs.mkdirSync(campDir, { recursive: true });
  fs.mkdirSync(baseMap, { recursive: true });
  stratPath = path.join(campDir, "descr_strat.txt");
  fs.writeFileSync(stratPath, STRAT(["roman hastati"]));
  fs.writeFileSync(path.join(modDir, "export_descr_unit.txt"), EDU);
  fs.writeFileSync(path.join(baseMap, "descr_regions.txt"), REGIONS);
  writeTGA(path.join(baseMap, "map_regions.tga"));
});

describe("garrisonMenByCity", () => {
  test("maps the settlement tile's men to the city name", () => {
    expect(garrisonMenByCity(modDir)).toEqual({ My_Town: 20 * 4 });
  });
});

describe("loadOrCreateBaseline — save is the starting point", () => {
  test("first analysis snapshots; later edits DON'T move the baseline, only the delta", () => {
    const savePath = path.join(baseDir, "fake calib.sav"); // key only — file need not exist
    const b1 = loadOrCreateBaseline(savePath, modDir, baseDir, null);
    expect(b1.created).toBe(true);
    expect(b1.menByCity).toEqual({ My_Town: 80 });
    // Army Setup-style apply: +1 unit, mtime bumped
    fs.writeFileSync(stratPath, STRAT(["roman hastati", "roman principes"]));
    bumpMtime(stratPath);
    const b2 = loadOrCreateBaseline(savePath, modDir, baseDir, null);
    expect(b2.created).toBe(false);
    expect(b2.menByCity).toEqual({ My_Town: 80 }); // baseline pinned to save time
    expect(garrisonMenByCity(modDir)).toEqual({ My_Town: 200 }); // live table moved
    // pop 4000: pts 80→1, 200→3 ⇒ anchored PO gets +10 on top of the save value
    expect(garrisonAdjust(200, 80, 4000)).toBe(10);
  });

  test("distinct saves get distinct baselines", () => {
    const a = loadOrCreateBaseline(path.join(baseDir, "a.sav"), modDir, baseDir, null);
    fs.writeFileSync(stratPath, STRAT(["roman hastati", "roman principes"]));
    bumpMtime(stratPath);
    const b = loadOrCreateBaseline(path.join(baseDir, "b.sav"), modDir, baseDir, null);
    expect(a.menByCity.My_Town).toBe(80);
    expect(b.menByCity.My_Town).toBe(200);
  });
});

describe("garrisonAdjust — exact garrison law delta", () => {
  test("adds, removals, cap, and no-op", () => {
    // pop 4000: floor(70·men/4000) → 184 men=3pts, 344=6pts ⇒ +15
    expect(garrisonAdjust(344, 184, 4000)).toBe(15);
    expect(garrisonAdjust(184, 344, 4000)).toBe(-15); // removal, symmetric
    expect(garrisonAdjust(99999, 88888, 4000)).toBe(0); // both over the 16-pt cap
    expect(garrisonAdjust(184, 184, 4000)).toBe(0);
    expect(garrisonAdjust(200, null, 4000)).toBe(0); // no baseline → no adjustment
    expect(garrisonAdjust(200, 80, 0)).toBe(0); // unusable pop
  });
});
