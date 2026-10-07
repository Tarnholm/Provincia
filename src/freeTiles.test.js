// Where a brought-in character may stand (src/freeTiles.js). The rule (user,
// 2026-10-07): only the leader on the town's tile; everyone else on the nearest
// FREE tile of the region — no mountain, dense forest, river, sea, cliff,
// volcano or other character — and failing that, in a bordering region.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { makeTileMap, placeCharacters } = require("./freeTiles.js");
const { tgaToRaw, parseDescrRegions, buildRegionCoords } = require("./descrStratGeneral.js");

// A W×H raster, bottom-origin like the real maps; fill(x, y) → [r,g,b].
function raster(W, H, fill) {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fill(x, y); const o = (y * W + x) * 3;
    raw[o] = b; raw[o + 1] = g; raw[o + 2] = r;
  }
  return { W, H, desc: 0, raw };
}
const A = [10, 20, 30], B = [40, 50, 60], SEA = [41, 140, 233], BLACK = [0, 0, 0];
const FERTILE = [101, 124, 0], MOUNTAIN = [98, 65, 65], HIGH = [196, 128, 128], DENSE = [0, 64, 0], SHALLOW = [196, 0, 0], DEEP = [64, 0, 0];

// 8×4 map: columns 0-3 region A (town at 1,1), 4-6 region B, column 7 sea.
function world({ ground = () => FERTILE, feature = () => BLACK } = {}) {
  const regions = raster(8, 4, (x, y) => (x === 7 ? SEA : x === 1 && y === 1 ? BLACK : x < 4 ? A : B));
  // ground is 2N+1: the tile's centre subpixel is (2x+1, 2y+1)
  const groundTga = raster(17, 9, (gx, gy) => {
    const x = (gx - 1) / 2, y = (gy - 1) / 2;
    if (Number.isInteger(x) && Number.isInteger(y) && x < 8 && y < 4) return x === 7 ? SHALLOW : ground(x, y);
    return FERTILE;
  });
  const tiles = makeTileMap({ regions, ground: groundTga, features: raster(8, 4, feature), rgbToRegion: { "10,20,30": "Alpha", "40,50,60": "Beta" } });
  return { tiles, towns: { Alpha: { x: 1, y: 1 }, Beta: { x: 5, y: 2 } }, cityOf: { Alpha: "Alphaville", Beta: "Betaburg" } };
}
const LEADER = { name: "Apaes", role: "leader", region: "Alpha" };
const HEIR = { name: "Pompo", role: "heir", region: "Alpha" };

describe("placeCharacters", () => {
  it("puts the leader in the town and the heir on the nearest free tile, never the same one", () => {
    const r = placeCharacters({ ...world(), chars: [HEIR, LEADER] });
    expect(r.errors).toEqual([]);
    expect(r.placements.Apaes).toMatchObject({ x: 1, y: 1, comment: ";Alphaville" });
    const p = r.placements.Pompo;
    expect([p.x, p.y]).not.toEqual([1, 1]);
    expect((p.x - 1) ** 2 + (p.y - 1) ** 2).toBe(1); // a neighbour of the town
    expect(p.comment).toBe(";Outside Alphaville");
  });

  it("skips mountains, high mountains, dense forest, river/cliff/volcano marks and occupied tiles", () => {
    // every tile next to the town is bad in a different way; (3,3) is the only good one
    const bad = { "0,1": MOUNTAIN, "2,1": HIGH, "1,0": DENSE, "1,2": DEEP, "0,0": MOUNTAIN, "2,2": DENSE, "0,2": HIGH, "2,0": MOUNTAIN, "0,3": DENSE, "1,3": DENSE, "2,3": DENSE, "3,0": DENSE };
    const feat = { "3,1": [0, 0, 255], "3,2": [255, 255, 0] }; // river, cliff
    const w = world({ ground: (x, y) => bad[x + "," + y] || FERTILE, feature: (x, y) => feat[x + "," + y] || BLACK });
    const r = placeCharacters({ ...w, occupied: [], chars: [HEIR] });
    expect(r.placements.Pompo).toMatchObject({ x: 3, y: 3, region: "Alpha" });
    // and with (3,3) taken by someone, Alpha is full -> Beta, next door
    const full = placeCharacters({ ...w, occupied: ["3,3"], chars: [HEIR] });
    expect(full.placements.Pompo.region).toBe("Beta");
    expect(full.placements.Pompo.comment).toBe(";Outside Betaburg");
    expect(full.notes.join(" ")).toMatch(/Pompo is placed in Beta/);
  });

  it("gives every character its own tile", () => {
    const many = ["a", "b", "c", "d", "e"].map((n) => ({ name: n, role: null, region: "Alpha" }));
    const r = placeCharacters({ ...world(), chars: [LEADER, ...many] });
    const spots = Object.values(r.placements).map((p) => p.x + "," + p.y);
    expect(new Set(spots).size).toBe(6);
  });

  it("moves the leader out of a town another character already stands in, and says so", () => {
    const r = placeCharacters({ ...world(), occupied: ["1,1"], chars: [LEADER] });
    expect([r.placements.Apaes.x, r.placements.Apaes.y]).not.toEqual([1, 1]);
    expect(r.notes.join(" ")).toMatch(/cannot stand in Alphaville/);
  });

  it("puts an admiral on shallow sea, never on land", () => {
    const r = placeCharacters({ ...world(), chars: [{ name: "Nauarchos", kind: "admiral", region: "Beta" }] });
    expect(r.placements.Nauarchos).toMatchObject({ x: 7, comment: ";Port of Betaburg" });
  });

  it("refuses rather than invent a tile when nothing is free", () => {
    const w = world({ ground: () => DENSE });
    const r = placeCharacters({ ...w, chars: [HEIR] });
    expect(r.errors.join(" ")).toMatch(/no free tile in Alpha or any region bordering it/);
  });
});

// ── on the real RIS_Light map ───────────────────────────────────────────────
const LIGHT = "C:/RIS/_submods/RIS_Light/data/world/maps/base";
const haveLight = fs.existsSync(LIGHT + "/map_ground_types.tga");

describe.skipIf(!haveLight)("RIS_Light: the Picentes at Asculum", () => {
  it("leader in Asculum, heir on a free land tile of Picenum", () => {
    const { rgbToRegion, regionToCity } = parseDescrRegions(fs.readFileSync(LIGHT + "/descr_regions.txt", "utf8"));
    const regBuf = fs.readFileSync(LIGHT + "/map_regions.tga");
    const tiles = makeTileMap({
      regions: tgaToRaw(regBuf), ground: tgaToRaw(fs.readFileSync(LIGHT + "/map_ground_types.tga")),
      features: tgaToRaw(fs.readFileSync(LIGHT + "/map_features.tga")), rgbToRegion,
    });
    const towns = buildRegionCoords(regBuf, rgbToRegion);
    expect(towns.Picenum).toEqual({ x: 148, y: 209 });
    const r = placeCharacters({ tiles, towns, cityOf: regionToCity, chars: [
      { name: "Apaes", role: "leader", region: "Picenum" }, { name: "Pompo", role: "heir", region: "Picenum" }] });
    expect(r.errors).toEqual([]);
    expect(r.placements.Apaes).toMatchObject({ x: 148, y: 209, comment: ";Asculum" });
    const p = r.placements.Pompo;
    expect(p.region).toBe("Picenum");
    expect(tiles.regionAt(p.x, p.y)).toBe("Picenum");
    expect(tiles.landOk(p.x, p.y)).toBe(true);
    expect(p.comment).toBe(";Outside Asculum");
  });
});
