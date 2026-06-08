// src/mercenaryParser.js
//
// Parse the campaign's descr_mercenaries.txt into mercenary POOLS so Provincia can
// show "where can I hire which mercenaries" as a map layer (2026-06-08).
//
// File format (RTW imperial_campaign/descr_mercenaries.txt):
//   pool <pool name>
//   regions <Region1> <Region2> ...
//   unit merc <unit name>, exp E cost C replenish A - B max M initial I [restrict <fac,fac,…>]
//   ...
//   (blank line between pools)
//
// Returns:
//   { pools: [{ name, regions:[…], units:[{ name, exp, cost, replenish:[a,b], max, initial,
//               restrict:[…] }] }],
//     byRegion: { <RegionName>: { pool, units:[…] } },   // region → its pool + units
//     poolNames: […] }
// Region names match descr_regions region names (the map's region labels).

"use strict";

const fs = require("fs");
const path = require("path");

function findDescrMercenaries(modDataDir) {
  const cands = [
    ["world", "maps", "campaign", "imperial_campaign", "descr_mercenaries.txt"],
    ["world", "maps", "campaign", "alexander", "descr_mercenaries.txt"],
    ["world", "maps", "campaign", "barbarian_invasion", "descr_mercenaries.txt"],
  ];
  for (const c of cands) { const p = path.join(modDataDir, ...c); if (fs.existsSync(p)) return p; }
  return null;
}

// Parse one `unit merc …` line. Returns the unit object or null.
function parseUnitLine(line) {
  // unit merc <name>, exp E cost C replenish A - B max M initial I [restrict f,f,…]
  const m = line.match(/^\s*unit\s+merc\s+(.+?),\s*(.*)$/i);
  if (!m) return null;
  const name = m[1].trim();
  const rest = m[2];
  const num = (key) => { const r = rest.match(new RegExp(key + "\\s+(-?[\\d.]+)", "i")); return r ? parseFloat(r[1]) : null; };
  const replenish = (() => {
    const r = rest.match(/replenish\s+([\d.]+)\s*-\s*([\d.]+)/i);
    return r ? [parseFloat(r[1]), parseFloat(r[2])] : null;
  })();
  const restrict = (() => {
    const r = rest.match(/restrict\s+(.+)$/i);
    return r ? r[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  })();
  return {
    name,
    exp: num("exp"),
    cost: num("cost"),
    replenish,
    max: num("max"),
    initial: num("initial"),
    restrict,
  };
}

function parseMercenaries(modDataDir) {
  const p = findDescrMercenaries(modDataDir);
  if (!p) return { error: "descr_mercenaries.txt not found", pools: [], byRegion: {}, poolNames: [] };
  const text = fs.readFileSync(p, "latin1");
  const lines = text.split(/\r?\n/);
  const pools = [];
  let cur = null;
  for (let raw of lines) {
    const line = raw.replace(/;.*$/, ""); // strip comments
    const pm = line.match(/^\s*pool\s+(.+\S)/i);
    if (pm) { cur = { name: pm[1].trim(), regions: [], units: [] }; pools.push(cur); continue; }
    if (!cur) continue;
    const rm = line.match(/^\s*regions\s+(.+\S)/i);
    if (rm) { cur.regions = rm[1].trim().split(/\s+/); continue; }
    if (/^\s*unit\s+merc\s+/i.test(line)) { const u = parseUnitLine(line); if (u) cur.units.push(u); }
  }
  // region → ALL pools covering it (regions can belong to several overlapping
  // pools; the region's hireable mercs = the union across those pools).
  const byRegion = {};
  for (const pool of pools) {
    for (const reg of pool.regions) {
      const e = byRegion[reg] || (byRegion[reg] = { pools: [], units: [] });
      e.pools.push(pool.name);
      for (const u of pool.units) e.units.push({ ...u, pool: pool.name });
    }
  }
  // de-dup units by name within a region (keep the cheapest / first)
  for (const reg of Object.keys(byRegion)) {
    const seen = new Set(); const merged = [];
    for (const u of byRegion[reg].units) { const k = u.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); merged.push(u); }
    byRegion[reg].units = merged.sort((a, b) => (a.cost || 0) - (b.cost || 0));
  }
  return { pools, byRegion, poolNames: pools.map((p) => p.name), file: p };
}

module.exports = { parseMercenaries, findDescrMercenaries, parseUnitLine };
