// src/tileResolver.js
//
// (tileX, tileY) → settlement-name resolver for the faction AI WORLD-KNOWLEDGE
// feature (FACTION_RECORD_TAIL tag-27 tuples). Each tuple's (f1=tileX, f2=tileY)
// is the GLOBAL WORLD TILE of the settlement it describes; this turns that pair
// back into a human-readable { region, settlement } using the campaign map.
//
// HOW IT WORKS (ported from rtw-sav-parser/probes/faction-tail-coords/*.py,
// validated exact on 6025/6026 julii1 tuples):
//   * map_regions.tga: every region is a solid RGB colour (defined in
//     descr_regions.txt); every settlement is a single PURE-BLACK (0,0,0) pixel
//     inside its region's colour patch.
//   * For each black pixel we read the surrounding region colour (spiral
//     outward, majority vote — robust against coastline/border noise), map the
//     colour → region name via descr_regions RGB triple, then region →
//     settlement name via descr_regions block.
//   * The engine tile Y is bottom-left-origin: engine_y = (H - 1 - image_row).
//     The index is keyed by (tileX, engine_y) so it matches the save's (f1,f2).
//
// The index is MAP-STATIC per mod (only changes if map_regions.tga or
// descr_regions.txt change), so callers can build it once and reuse it.
//
// Pure data module (filesystem reads only); safe for dev scripts and the
// bundled app. No heavy work happens unless buildTileIndex is called.

"use strict";

const fs = require("fs");
const path = require("path");

const { parseDescrRegions, findDescrRegions } = require("./ownershipParser.js");
const { tgaToRaw } = require("./descrStratGeneral.js");

const SKIP_COLORS = new Set(["0,0,0", "255,255,255"]);

// Parse descr_regions.txt for the RGB→region map. descr_regions block shape:
//   RegionName
//       SettlementName
//       initial_owner_faction
//       rebel_name
//       r g b           <- line index +4 from the region name
//       ...
// (mirrors loadSettlementCoords in scripts/save-to-descr-strat.js and
// parseDescrRegions in src/descrStratGeneral.js — kept local so this module
// works straight off a file path with no extra wiring.)
function parseRgbToRegion(regionsPath) {
  const text = fs.readFileSync(regionsPath, "utf8");
  const lines = text.split(/\r?\n/);
  const rgbToRegion = {};
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    if (!name || /^[;\s]/.test(name) || !/^[A-Za-z]/.test(name)) continue;
    const rgbLine = (lines[i + 4] || "").trim();
    const m = rgbLine.match(/^(\d+)\s+(\d+)\s+(\d+)/);
    if (m) {
      const key = `${+m[1]},${+m[2]},${+m[3]}`;
      // First definition wins (matches Python's setdefault).
      if (!(key in rgbToRegion)) rgbToRegion[key] = name.trim();
    }
  }
  return rgbToRegion;
}

// 24bpp TGA reader. Returns { W, H, px(col, rowTop) }.
// px gives [r,g,b] for a TOP-DOWN image row (row 0 = top), accounting for the
// TGA origin flag — so callers can reason in image-row space and convert to
// engine_y = H-1-row. Decoding is delegated to tgaToRaw, which handles both
// uncompressed (type 2) and RLE (type 10) — RIS re-saves its map TGAs as RLE
// on some updates (2026-07-20: map_regions.tga went 2.1MB → 174KB and this
// module's old direct-offset reader silently returned garbage pixels).
function openTga(tgaBuf) {
  const { W, H, desc, raw } = tgaToRaw(tgaBuf);
  const bottomLeft = (desc & 0x20) === 0; // bit5 clear = bottom-left origin
  const px = (col, rowTop) => {
    const r = bottomLeft ? H - 1 - rowTop : rowTop;
    const o = (r * W + col) * 3;
    return [raw[o + 2], raw[o + 1], raw[o]]; // TGA stores BGR
  };
  return { W, H, px };
}

// Spiral outward from (col, rowTop) up to `maxR` rings; at each ring collect
// every pixel whose colour is a known region colour and return the majority
// vote. Mirrors Python settlement_tiles.neighbor_color — more robust than a
// fixed 6-neighbour probe when a settlement pixel sits on a coastline/border.
function neighborColor(px, col, rowTop, W, H, validColors, maxR) {
  for (let r = 1; r <= maxR; r++) {
    const votes = new Map();
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // ring = Chebyshev distance exactly r (don't recount inner rings)
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = col + dx;
        const ny = rowTop + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const [cr, cg, cb] = px(nx, ny);
        const key = `${cr},${cg},${cb}`;
        if (validColors.has(key)) votes.set(key, (votes.get(key) || 0) + 1);
      }
    }
    if (votes.size) {
      let best = null, bestN = -1;
      for (const [k, n] of votes) if (n > bestN) { best = k; bestN = n; }
      return best;
    }
  }
  return null;
}

// Build the (tileX, engine_y) → { region, settlement } index from a mod's
// data dir. Reads world/maps/base/map_regions.tga + descr_regions.txt.
// Returns an object with:
//   resolve(tileX, tileY) -> { region, settlement } | null
//   index:        Map keyed "x,engineY" -> { region, settlement }  (raw access)
//   regionCount:  number of regions resolved (≈1310 for the RIS world map)
//   W, H:         map dimensions
// Throws if the map files are missing (caller decides whether that's fatal).
function buildTileIndex(modDataDir, opts = {}) {
  const campaign = opts.campaign || "imperial_campaign";
  const tgaPath = path.join(modDataDir, "world", "maps", "base", "map_regions.tga");
  const regionsPath = findDescrRegions(modDataDir, campaign);
  if (!fs.existsSync(tgaPath)) {
    throw new Error(`map_regions.tga not found: ${tgaPath}`);
  }
  if (!regionsPath) {
    throw new Error(`descr_regions.txt not found under ${modDataDir}`);
  }

  const regionToSettlement = parseDescrRegions(regionsPath);
  const rgbToRegion = parseRgbToRegion(regionsPath);
  const validColors = new Set(Object.keys(rgbToRegion));

  const tgaBuf = fs.readFileSync(tgaPath);
  const { W, H, px } = openTga(tgaBuf);
  const maxR = opts.maxRadius || 12;

  const index = new Map();
  // First black pixel per region wins (matches Python region_tile keyed by
  // region — a region has exactly one settlement / black pixel on the map).
  const seenRegion = new Set();
  let unmatched = 0;
  for (let rowTop = 0; rowTop < H; rowTop++) {
    for (let col = 0; col < W; col++) {
      const [r, g, b] = px(col, rowTop);
      if (r !== 0 || g !== 0 || b !== 0) continue; // settlements are pure black
      const col2 = neighborColor(px, col, rowTop, W, H, validColors, maxR);
      const region = col2 ? rgbToRegion[col2] : null;
      if (!region) { unmatched++; continue; }
      if (seenRegion.has(region)) continue;
      seenRegion.add(region);
      const engineY = H - 1 - rowTop;
      const settlement = regionToSettlement[region] || null;
      index.set(`${col},${engineY}`, { region, settlement });
    }
  }

  const resolve = (tileX, tileY) => {
    if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) return null;
    return index.get(`${tileX},${tileY}`) || null;
  };

  return { resolve, index, regionCount: seenRegion.size, unmatched, W, H };
}

module.exports = { buildTileIndex, parseRgbToRegion, openTga };
