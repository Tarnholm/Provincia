// Where a character can stand on a campaign map — for tools that put new
// characters into descr_strat (☥ Bring In a Faction, ✚ New Faction).
//
// THE RULE (user, 2026-10-07). Only the faction leader goes on the town's own
// tile. Everyone else gets a FREE tile inside the town's region, the nearest one
// to the town; if the region has none, the nearest free tile in a region that
// borders it. Free = none of: mountain, dense forest, river, sea, cliff,
// volcano, or another character already standing there.
//
// WHERE EACH TEST COMES FROM (measured on RIS + RIS_Light):
//   • map_regions.tga — the tile must be the region's own colour, which also
//     rules out the town (black), its port (white) and the sea.
//   • map_ground_types.tga — 2N+1 resolution (RIS 2041×1401 vs 1020×700, Light
//     1021×701 vs 510×350); a tile's ground is its CENTRE subpixel (2x+1, 2y+1).
//     The centre is what the engine judges a tile by: the two RIS v7.14 towns that
//     failed to place were exactly the two with dense forest on the centre.
//     Blocked: Mountains, High mountains, Dense forest, every sea class.
//   • map_features.tga — same size as map_regions; black is empty. The other five
//     colours present (blue, cyan, white, yellow, red) are the river, ford, river
//     source, cliff and volcano marks — ANY non-black pixel blocks the tile, so
//     nothing here depends on which colour is which.
//   • All three are bottom-origin: tile (x,y) is raw row y, no flip (city-pixel
//     anchor, see descrStratGeneral.buildRegionCoords).
//
// Admirals are the exception the rule does not cover: a fleet only spawns on
// SHALLOW sea (196,0,0) at the tile centre — deep-sea centres were measured
// "invalid tile" in RIS v7.13 — so they get the nearest free shallow tile.
"use strict";

const { GROUND_TYPES } = require("./aiTerrainAudit.js");

const LAND_BLOCKED = new Set(["Mountains", "High mountains", "Dense forest"]);
const SHALLOW_SEA = "196,0,0";
const ADMIRAL_RADIUS = 8;

const key = (x, y) => x + "," + y;

/**
 * @param {object} m
 * @param {{W,H,desc,raw}} m.regions   decoded map_regions.tga (tgaToRaw)
 * @param {{W,H,desc,raw}} m.ground    decoded map_ground_types.tga
 * @param {{W,H,desc,raw}} [m.features] decoded map_features.tga
 * @param {Object<string,string>} m.rgbToRegion "r,g,b" → region
 */
function makeTileMap({ regions, ground, features = null, rgbToRegion }) {
  const rgbAt = (img, px, py) => {
    const row = (img.desc & 0x20) ? img.H - 1 - py : py;
    const o = (row * img.W + px) * 3;
    return img.raw[o + 2] + "," + img.raw[o + 1] + "," + img.raw[o];
  };
  // tile → pixel in a map of another size: 2N+1 maps use the centre subpixel
  const sub = (img, x, y) => {
    if (img.W === 2 * regions.W + 1 && img.H === 2 * regions.H + 1) return [2 * x + 1, 2 * y + 1];
    return [Math.min(img.W - 1, Math.floor((x + 0.5) * img.W / regions.W)), Math.min(img.H - 1, Math.floor((y + 0.5) * img.H / regions.H))];
  };
  const inMap = (x, y) => x >= 0 && y >= 0 && x < regions.W && y < regions.H;
  const regionAt = (x, y) => (inMap(x, y) ? rgbToRegion[rgbAt(regions, x, y)] || null : null);
  const groundAt = (x, y) => { const [gx, gy] = sub(ground, x, y); return rgbAt(ground, gx, gy); };
  const featureAt = (x, y) => {
    if (!features) return "0,0,0";
    const [fx, fy] = features.W === regions.W && features.H === regions.H ? [x, y] : sub(features, x, y);
    return rgbAt(features, fx, fy);
  };

  function landOk(x, y) {
    const g = GROUND_TYPES[groundAt(x, y)];
    if (!g || g.cls === "sea" || LAND_BLOCKED.has(g.name)) return false;
    return featureAt(x, y) === "0,0,0";
  }
  function seaOk(x, y) {
    return inMap(x, y) && !regionAt(x, y) && groundAt(x, y) === SHALLOW_SEA && featureAt(x, y) === "0,0,0";
  }

  // region → tiles, region → bordering regions; one pass, built on first use
  let tilesOf = null, neighboursOf = null;
  function index() {
    if (tilesOf) return;
    tilesOf = new Map(); neighboursOf = new Map();
    const link = (a, b) => {
      if (!a || !b || a === b) return;
      if (!neighboursOf.has(a)) neighboursOf.set(a, new Set());
      if (!neighboursOf.has(b)) neighboursOf.set(b, new Set());
      neighboursOf.get(a).add(b); neighboursOf.get(b).add(a);
    };
    for (let y = 0; y < regions.H; y++) {
      for (let x = 0; x < regions.W; x++) {
        const r = regionAt(x, y);
        if (!r) continue;
        if (!tilesOf.has(r)) tilesOf.set(r, []);
        tilesOf.get(r).push([x, y]);
        link(r, regionAt(x + 1, y));
        link(r, regionAt(x, y + 1));
      }
    }
  }

  const nearest = (tiles, from, ok) => {
    let best = null, bestD = Infinity;
    for (const [x, y] of tiles) {
      const d = (x - from.x) ** 2 + (y - from.y) ** 2;
      if (d < bestD && ok(x, y)) { best = { x, y }; bestD = d; }
    }
    return best;
  };

  return {
    regionAt,
    landOk, seaOk,
    neighbours(region) { index(); return [...(neighboursOf.get(region) || [])].sort(); },

    // nearest free land tile to `from`: in `region`, else in a region bordering it
    freeLand(region, from, occupied) {
      index();
      const ok = (x, y) => !occupied.has(key(x, y)) && landOk(x, y);
      const here = nearest(tilesOf.get(region) || [], from, ok);
      if (here) return { ...here, region, neighbour: false };
      let best = null;
      for (const n of neighboursOf.get(region) || []) {
        const t = nearest(tilesOf.get(n) || [], from, ok);
        if (t && (!best || (t.x - from.x) ** 2 + (t.y - from.y) ** 2 < (best.x - from.x) ** 2 + (best.y - from.y) ** 2)) best = { ...t, region: n, neighbour: true };
      }
      return best;
    },

    // nearest free shallow-sea tile to `from`, within ADMIRAL_RADIUS
    freeSea(from, occupied) {
      const tiles = [];
      for (let dy = -ADMIRAL_RADIUS; dy <= ADMIRAL_RADIUS; dy++) for (let dx = -ADMIRAL_RADIUS; dx <= ADMIRAL_RADIUS; dx++) tiles.push([from.x + dx, from.y + dy]);
      return nearest(tiles, from, (x, y) => !occupied.has(key(x, y)) && seaOk(x, y));
    },
  };
}

/**
 * Put a list of characters on the map, in order, each on its own tile.
 *
 *   tiles      makeTileMap(...)
 *   towns      { region: {x,y} } — the settlement tiles
 *   cityOf     { region: city name } — for the `;Asculum` comment above each
 *   occupied   tiles already taken by characters on the map ("x,y" strings)
 *   chars      [{ name, role, kind, region }] — `region` = the town they belong to
 *
 * Returns { placements: { name: {x,y,comment,region} }, notes, errors }.
 */
function placeCharacters({ tiles, towns, cityOf = {}, occupied = [], chars = [] }) {
  const taken = new Set(occupied);
  const placements = {}, notes = [], errors = [];
  const city = (r) => cityOf[r] || r;
  // the leader claims the town first, whatever order the list is in
  const order = chars.slice().sort((a, b) => (b.role === "leader") - (a.role === "leader"));
  for (const c of order) {
    const town = towns[c.region];
    if (!town) { errors.push(`no tile on this map for ${c.region}'s town`); continue; }
    let at = null;
    if (c.kind === "admiral") {
      const t = tiles.freeSea(town, taken);
      if (t) at = { x: t.x, y: t.y, region: c.region, comment: `;Port of ${city(c.region)}` };
      else errors.push(`no free shallow-sea tile within ${ADMIRAL_RADIUS} of ${city(c.region)} for the admiral ${c.name}`);
    } else if (c.role === "leader" && !taken.has(key(town.x, town.y))) {
      at = { x: town.x, y: town.y, region: c.region, comment: `;${city(c.region)}` };
    } else {
      if (c.role === "leader") notes.push(`${c.name} cannot stand in ${city(c.region)} — another character is already there`);
      const t = tiles.freeLand(c.region, town, taken);
      if (t) {
        at = { x: t.x, y: t.y, region: t.region, comment: `;Outside ${city(t.region)}` };
        if (t.neighbour) notes.push(`${c.name} is placed in ${t.region} — ${c.region} has no free tile`);
      } else errors.push(`no free tile in ${c.region} or any region bordering it for ${c.name}`);
    }
    if (at) { placements[c.name] = at; taken.add(key(at.x, at.y)); }
  }
  return { placements, notes, errors };
}

module.exports = { makeTileMap, placeCharacters, LAND_BLOCKED, SHALLOW_SEA };
