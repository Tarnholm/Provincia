// parser/tradeNetwork.js
//
// TRADE-ROUTE derivation foundation for RTW:R / RIS — engine-DERIVED (not stored
// in the save). Computes, from a save buffer + the mod's data dir:
//
//   1. Region land-adjacency graph   (from map_regions.tga + descr_regions RGB)
//   2. Sea connectivity              (sea bodies in the TGA; which land regions
//                                     have a coastline on which sea body)
//   3. Per-settlement road + port flags (from the save's built-building list,
//                                     cross-referenced to EDB chain names)
//   4. Trade-partner gating          (own faction internal + cross-faction only
//                                     where a trade bond exists in the cracked
//                                     diplomacy matrix)
//   5. First-cut trade connectivity  (per settlement: the set of OTHER
//                                     settlements it can reach for trade via a
//                                     road-connected land path through
//                                     passage-permitting owners, OR via a shared
//                                     connected sea body when both have a port,
//                                     AND trade-rights hold)
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS AN ENGINE-APPROXIMATION. It models trade CONNECTIVITY and PARTNERS
// only. The actual trade GOLD value the engine computes depends on distance,
// traded resources, route capacity, sea-lane length, blockades and tariff
// settings — all OUT OF SCOPE here. "Can A trade with B?" is what this answers.
// ─────────────────────────────────────────────────────────────────────────────
//
// Reuses Provincia's authoritative parsers (no duplication of cracked logic):
//   • src/tileResolver.js      openTga, parseRgbToRegion
//   • src/ownershipParser.js   parseDescrRegions, findDescrRegions
//   • src/saveCracker.js       crackSave  (settlements, ownerByCity, diplomacy)
//
// Pure-data module: filesystem + buffer reads only. No app/electron deps.

"use strict";

const fs = require("fs");
const path = require("path");

const { openTga, parseRgbToRegion } = require("./tileResolver.js");
const { parseDescrRegions, findDescrRegions } = require("./ownershipParser.js");
const { crackSave } = require("./saveCracker.js");

// ── EDB chain classification ────────────────────────────────────────────────
// The built-building list in the save gives chain NAMES per settlement. We need
// the EDB to (a) build a whitelist that filters event-spawned pseudo-buildings
// (e.g. eruption_at_etna_NN) out of the building parser, and (b) know which
// chains are ROADS vs PORTS.
//
// RIS (verified 2026-05-31 against export_descr_buildings.txt):
//   ROAD chain : hinterland_roads          levels: roads / paved_roads / highways
//   PORT chains: port_buildings (tag port) levels: port / shipwright / dockyard
//                harbour                   levels: harbour
//                river_port                (inland — gives river trade, NOT a
//                                            sea port; tracked separately)
// A "port" for SEA trade = port_buildings or harbour. river_port is a river
// trade dock and does NOT open sea-lane trade, so it is NOT counted as a sea port.
const ROAD_CHAIN = "hinterland_roads";
const SEA_PORT_CHAINS = new Set(["port_buildings", "harbour"]);
const RIVER_PORT_CHAINS = new Set(["river_port"]);

function loadEdbChains(modDataDir) {
  const edbPath = path.join(modDataDir, "export_descr_buildings.txt");
  const chains = new Set();
  if (!fs.existsSync(edbPath)) return { chains, edbPath: null };
  const text = fs.readFileSync(edbPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^building\s+(\w+)/);
    if (m) chains.add(m[1]);
  }
  return { chains, edbPath };
}

// ── TGA region geometry ───────────────────────────────────────────────────────
// Build, in ONE pass over the bitmap:
//   • landAdj   : regionName -> Set(regionName)   (land regions whose colour
//                  patches share a 4-connected pixel border)
//   • seaLabel  : per-pixel sea-body label (flood-fill of the sea colours)
//   • regionSeas: regionName -> Set(seaBodyId)    (sea bodies a region's land
//                  patch touches = its coastline)
//   • seaAdjPairs: connectivity is implicit — two coastal regions on the SAME
//                  seaBodyId share a sea lane.
//
// Sea pixels = any non-black, non-white pixel whose colour is NOT a known land
// colour (in RIS these are the 41,140,xxx blue shades). White (255,255,255) is
// the coastline outline; black (0,0,0) is the settlement marker. Both are
// treated as "transparent" for adjacency (skipped), which is fine because land
// patches abut each other directly and land abuts sea directly in the vast
// majority of border pixels; the thin white outline does not disconnect regions
// that genuinely share a long border. (Validated by the edge count below.)
function buildGeometry(modDataDir, opts = {}) {
  const campaign = opts.campaign || "imperial_campaign";
  const tgaPath = path.join(modDataDir, "world", "maps", "base", "map_regions.tga");
  const regionsPath = findDescrRegions(modDataDir, campaign);
  if (!fs.existsSync(tgaPath)) throw new Error(`map_regions.tga not found: ${tgaPath}`);
  if (!regionsPath) throw new Error(`descr_regions.txt not found under ${modDataDir}`);

  const rgbToRegion = parseRgbToRegion(regionsPath);
  const tgaBuf = fs.readFileSync(tgaPath);
  const { W, H, px } = openTga(tgaBuf);

  // Classify every pixel into a cell-id grid:
  //   >=0  : land region index
  //   -1   : sea pixel (label assigned later)
  //   -2   : black/white (transparent: settlement marker or coastline outline)
  const regionNames = [];          // index -> regionName
  const regionIndex = new Map();   // regionName -> index
  const idOf = (name) => {
    let i = regionIndex.get(name);
    if (i === undefined) { i = regionNames.length; regionNames.push(name); regionIndex.set(name, i); }
    return i;
  };
  const SEA = -1, SKIP = -2;
  const cell = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = px(x, y);
      const o = y * W + x;
      if ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)) { cell[o] = SKIP; continue; }
      const name = rgbToRegion[`${r},${g},${b}`];
      cell[o] = name ? idOf(name) : SEA;
    }
  }

  // Flood-fill sea pixels into connected sea BODIES (4-connected). seaLabel[o]
  // = sea-body id (>=0) for sea pixels, -1 otherwise.
  const seaLabel = new Int32Array(W * H).fill(-1);
  let seaBodies = 0;
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (cell[start] !== SEA || seaLabel[start] !== -1) continue;
    const label = seaBodies++;
    stack.length = 0; stack.push(start);
    seaLabel[start] = label;
    while (stack.length) {
      const o = stack.pop();
      const x = o % W, y = (o / W) | 0;
      // 4-neighbours
      if (x > 0)     { const n = o - 1; if (cell[n] === SEA && seaLabel[n] === -1) { seaLabel[n] = label; stack.push(n); } }
      if (x < W - 1) { const n = o + 1; if (cell[n] === SEA && seaLabel[n] === -1) { seaLabel[n] = label; stack.push(n); } }
      if (y > 0)     { const n = o - W; if (cell[n] === SEA && seaLabel[n] === -1) { seaLabel[n] = label; stack.push(n); } }
      if (y < H - 1) { const n = o + W; if (cell[n] === SEA && seaLabel[n] === -1) { seaLabel[n] = label; stack.push(n); } }
    }
  }

  // Adjacency pass: for each land pixel, inspect right + down neighbour (covers
  // every 4-connected pair exactly once).
  const landAdj = new Map();   // idx -> Set(idx)
  const regionSeasIdx = new Map(); // idx -> Set(seaBodyId)
  const addAdj = (a, b) => {
    if (a === b) return;
    if (!landAdj.has(a)) landAdj.set(a, new Set());
    if (!landAdj.has(b)) landAdj.set(b, new Set());
    landAdj.get(a).add(b); landAdj.get(b).add(a);
  };
  const addSea = (idx, label) => {
    if (!regionSeasIdx.has(idx)) regionSeasIdx.set(idx, new Set());
    regionSeasIdx.get(idx).add(label);
  };
  const touchEdgeRadius = opts.coastRadius || 2; // probe a small radius across the
                                                 // white coastline outline so a
                                                 // land patch separated from the
                                                 // sea by the 1-2px white border
                                                 // still registers a coastline.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      const c = cell[o];
      if (c < 0) continue; // only originate from land pixels
      // right
      if (x < W - 1) {
        const r = cell[o + 1];
        if (r >= 0) addAdj(c, r);
        else if (r === SEA) addSea(c, seaLabel[o + 1]);
      }
      // down
      if (y < H - 1) {
        const d = cell[o + W];
        if (d >= 0) addAdj(c, d);
        else if (d === SEA) addSea(c, seaLabel[o + W]);
      }
    }
  }

  // Second light pass for coastlines hidden behind the white outline: for every
  // land pixel adjacent to a SKIP pixel, look outward up to touchEdgeRadius for
  // a sea pixel and, if found with land still in line of sight, attribute that
  // sea body to the region. This recovers coasts that the direct-neighbour pass
  // misses because a 1px white line sits between land and water.
  if (touchEdgeRadius > 0) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        const c = cell[o];
        if (c < 0) continue;
        // only bother if a neighbour is SKIP (likely a coastline outline)
        const hasSkipN =
          (x > 0 && cell[o - 1] === SKIP) || (x < W - 1 && cell[o + 1] === SKIP) ||
          (y > 0 && cell[o - W] === SKIP) || (y < H - 1 && cell[o + W] === SKIP);
        if (!hasSkipN) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let r = 1; r <= touchEdgeRadius; r++) {
            const nx = x + dx * r, ny = y + dy * r;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
            const n = ny * W + nx;
            if (cell[n] === SEA) { addSea(c, seaLabel[n]); break; }
            if (cell[n] >= 0) break; // hit other land — stop, not a coast in this dir
          }
        }
      }
    }
  }

  // Re-key by region NAME.
  const adjacency = {};      // regionName -> [regionName,...]
  for (const [a, set] of landAdj) {
    adjacency[regionNames[a]] = [...set].map((i) => regionNames[i]).sort();
  }
  const regionSeas = {};     // regionName -> [seaBodyId,...]
  for (const [a, set] of regionSeasIdx) {
    regionSeas[regionNames[a]] = [...set].sort((p, q) => p - q);
  }
  // seaBody -> [coastal regionNames]
  const seaToRegions = {};
  for (const [name, seas] of Object.entries(regionSeas)) {
    for (const s of seas) (seaToRegions[s] ||= []).push(name);
  }

  let edgeCount = 0;
  for (const set of landAdj.values()) edgeCount += set.size;
  edgeCount = edgeCount / 2;

  return {
    W, H,
    regionNames,
    adjacency,             // land-adjacency graph
    regionSeas,            // region -> sea bodies (coastline)
    seaToRegions,          // sea body -> coastal regions
    stats: {
      regions: regionNames.length,
      landEdges: edgeCount,
      seaBodies,
      coastalRegions: Object.keys(regionSeas).length,
    },
  };
}

// ── Settlement road/port flags ────────────────────────────────────────────────
// `settlements` come from crackSave (parsed with the EDB whitelist so junk is
// excluded). Returns name -> { road, seaPort, riverPort, roadLevel, portLevel }.
function settlementFlags(settlements) {
  const out = {};
  for (const s of settlements) {
    let road = false, seaPort = false, riverPort = false, roadLevel = null, portLevel = null;
    for (const b of s.buildings) {
      if (b.name === ROAD_CHAIN) { road = true; roadLevel = b.level; }
      else if (SEA_PORT_CHAINS.has(b.name)) { seaPort = true; if (portLevel == null || b.level > portLevel) portLevel = b.level; }
      else if (RIVER_PORT_CHAINS.has(b.name)) { riverPort = true; }
    }
    out[s.name] = { road, seaPort, riverPort, roadLevel, portLevel };
  }
  return out;
}

// ── Trade-rights gating ───────────────────────────────────────────────────────
// Cross-faction trade requires a trade bond. We use the cracked diplomacy
// matrix's per-faction `trade` list (bond>=54 = ally OR protectorate/suzerain).
//
// LIMITATION (documented, not fabricated): true RTW "trade rights" can also be
// granted with NO military bond (rel199 + bond6 = trade-rights / non-aggression
// pact — see saveCrackerExtras diplo-deep notes). The cracked matrix's `trade`
// array only captures bond>=54, so pure trade-rights-without-alliance pacts are
// NOT represented here and will be under-counted. Own-faction trade is always
// allowed. This is the gating the spec asked for (bond>=54); flagged so the
// approximation is clear.
function buildTradeRights(diplomacy) {
  // returns (factionA, factionB) -> bool  (A permits trade with B)
  const partners = {}; // factionLower -> Set(partnerLower)
  if (diplomacy) {
    for (const [name, rec] of Object.entries(diplomacy)) {
      if (name === "_meta" || !rec || !Array.isArray(rec.trade)) continue;
      partners[name.toLowerCase()] = new Set(rec.trade.map((n) => String(n).toLowerCase()));
    }
  }
  return (a, b) => {
    if (!a || !b) return false;
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return true;                       // own faction always trades
    const sa = partners[a];
    return !!(sa && sa.has(b));                     // trade bond A->B
  };
}

// ── First-cut trade connectivity ──────────────────────────────────────────────
// Per settlement, compute the set of OTHER settlements it can TRADE with.
//
// Model (engine-approximation):
//   LAND: settlement S reaches settlement T by land if there is a path
//     S.region → … → T.region through ADJACENT regions where every region on
//     the path has a ROAD built AND the path only crosses owners that PERMIT
//     PASSAGE for S's faction. "Permit passage" = same faction OR a trade-bond
//     partner of S's faction (allied/protectorate territory is traversable for
//     trade purposes in this approximation).
//     We additionally require BOTH endpoints to have a road (a settlement with
//     no road is not on the road network).
//   SEA : settlement S reaches T by sea if both have a SEA PORT and both regions
//     have a coastline on the SAME connected sea body.
//   Then trade-RIGHTS must hold between the two settlements' owners (own faction
//     always; cross-faction requires a trade bond).
//
// Output: name -> { faction, region, road, seaPort, partners:[names],
//   landPartners:[names], seaPartners:[names] }.
function computeTradeConnectivity(geometry, settlements, ownerByCity, region2settlement, settlement2region, flags, tradeRights) {
  const { adjacency, regionSeas, seaToRegions } = geometry;

  // settlement -> faction
  const factionOf = (name) => ownerByCity[name] || null;

  // ---- LAND reachability ----
  // Build a per-faction traversable region graph lazily. For settlement S
  // (faction F): traversable regions = regions that have a road AND whose owner
  // permits passage for F (own or trade-bond partner). BFS over adjacency within
  // that set from S's region; any settlement whose region is reached (and which
  // itself has a road) is a land partner, subject to trade-rights on the owner.
  const regionHasRoad = (region) => {
    const s = region2settlement[region];
    return !!(s && flags[s] && flags[s].road);
  };
  // memoize traversable-set BFS per faction (the road+passage graph only depends
  // on the FACTION, not the specific origin settlement).
  const landReachCache = new Map(); // faction -> Map(region -> componentId) + components[]
  function landComponentsFor(faction) {
    if (landReachCache.has(faction)) return landReachCache.get(faction);
    const permits = (region) => {
      const s = region2settlement[region];
      const owner = s ? factionOf(s) : null;
      if (!owner) return false;
      return tradeRights(faction, owner); // own faction OR trade-bond partner
    };
    // node set: regions with a road whose owner permits passage for `faction`
    const nodes = [];
    for (const region of Object.keys(adjacency)) {
      if (regionHasRoad(region) && permits(region)) nodes.push(region);
    }
    const nodeSet = new Set(nodes);
    const comp = new Map();
    const components = [];
    for (const start of nodes) {
      if (comp.has(start)) continue;
      const id = components.length;
      const members = [];
      const q = [start]; comp.set(start, id);
      while (q.length) {
        const r = q.pop(); members.push(r);
        for (const nb of (adjacency[r] || [])) {
          if (nodeSet.has(nb) && !comp.has(nb)) { comp.set(nb, id); q.push(nb); }
        }
      }
      components.push(members);
    }
    const res = { comp, components };
    landReachCache.set(faction, res);
    return res;
  }

  const result = {};
  const names = settlements.map((s) => s.name);

  for (const s of settlements) {
    const name = s.name;
    const faction = factionOf(name);
    const region = settlement2region[name];
    const f = flags[name] || {};
    const landPartners = new Set();
    const seaPartners = new Set();

    // LAND: only if this settlement has a road and its region permits its own
    // faction (it always does) — find its land component for its own faction.
    if (f.road && region && faction) {
      const { comp, components } = landComponentsFor(faction);
      const cid = comp.get(region);
      if (cid !== undefined) {
        for (const r of components[cid]) {
          const t = region2settlement[r];
          if (!t || t === name) continue;
          const owner = factionOf(t);
          if (owner && tradeRights(faction, owner)) landPartners.add(t);
        }
      }
    }

    // SEA: both endpoints have a sea port on a shared connected sea body.
    if (f.seaPort && region && (regionSeas[region] || []).length) {
      const seenSeas = new Set(regionSeas[region]);
      const cand = new Set();
      for (const seaId of seenSeas) for (const r of (seaToRegions[seaId] || [])) cand.add(r);
      for (const r of cand) {
        const t = region2settlement[r];
        if (!t || t === name) continue;
        const tf = flags[t];
        if (!tf || !tf.seaPort) continue;
        const owner = factionOf(t);
        if (owner && faction && tradeRights(faction, owner)) seaPartners.add(t);
      }
    }

    const partners = new Set([...landPartners, ...seaPartners]);
    result[name] = {
      faction,
      region,
      road: !!f.road,
      seaPort: !!f.seaPort,
      riverPort: !!f.riverPort,
      landPartners: [...landPartners].sort(),
      seaPartners: [...seaPartners].sort(),
      partners: [...partners].sort(),
    };
  }
  return { settlements: result, settlementCount: names.length };
}

// ── Top-level entrypoint ──────────────────────────────────────────────────────
// computeTradeNetwork(saveBuf, modDataDir, opts) -> {
//   geometry, flags, diplomacy, trade, stats
// }
function computeTradeNetwork(saveBuf, modDataDir, opts = {}) {
  const t0 = Date.now();
  const { chains, edbPath } = loadEdbChains(modDataDir);

  // crackSave parses settlements WITHOUT a whitelist; re-parse buildings with the
  // EDB whitelist so event pseudo-buildings don't pollute road/port detection.
  const cr = crackSave(saveBuf, modDataDir);
  const { parseSettlements } = require("./buildingParser.js");
  const settlements = (chains.size ? parseSettlements(saveBuf, chains, null).settlements : cr.settlements);

  const geometry = buildGeometry(modDataDir, opts);

  // region <-> settlement maps (from descr_regions)
  const regionsPath = findDescrRegions(modDataDir, opts.campaign || "imperial_campaign");
  const region2settlement = parseDescrRegions(regionsPath);
  const settlement2region = {};
  for (const [r, s] of Object.entries(region2settlement)) settlement2region[s] = r;

  const flags = settlementFlags(settlements);
  const tradeRights = buildTradeRights(cr.diplomacy);

  const trade = computeTradeConnectivity(
    geometry, settlements, cr.ownerByCity || {}, region2settlement, settlement2region, flags, tradeRights
  );

  // rollup stats
  let withRoad = 0, withSeaPort = 0, withRiverPort = 0;
  for (const v of Object.values(flags)) { if (v.road) withRoad++; if (v.seaPort) withSeaPort++; if (v.riverPort) withRiverPort++; }
  let totalPartnerLinks = 0, isolated = 0;
  for (const v of Object.values(trade.settlements)) {
    totalPartnerLinks += v.partners.length;
    if (v.partners.length === 0) isolated++;
  }

  return {
    playerFaction: cr.playerFaction,
    turn: cr.turn,
    geometry,
    flags,
    diplomacy: cr.diplomacy,
    ownerByCity: cr.ownerByCity || {},
    region2settlement,
    settlement2region,
    trade,
    stats: {
      ms: Date.now() - t0,
      edbPath,
      validChains: chains.size,
      ...geometry.stats,
      settlements: settlements.length,
      withRoad,
      withSeaPort,
      withRiverPort,
      isolatedSettlements: isolated,
      avgPartnersPerSettlement: +(totalPartnerLinks / Math.max(1, Object.keys(trade.settlements).length)).toFixed(2),
    },
  };
}

module.exports = {
  computeTradeNetwork,
  buildGeometry,
  settlementFlags,
  buildTradeRights,
  computeTradeConnectivity,
  loadEdbChains,
  ROAD_CHAIN,
  SEA_PORT_CHAINS,
  RIVER_PORT_CHAINS,
};
