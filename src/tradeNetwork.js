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
//   4. Trade-partner gating          (own faction internal + cross-faction where
//                                     TRADE RIGHTS exist: a military bond (matrix
//                                     bond>=54) OR allied state (matrix att==0 ==
//                                     descr_strat rel199, which folds in pure
//                                     trade-rights/non-aggression pacts), with the
//                                     descr_strat 199-ally pairs as a floor)
//   5. First-cut trade connectivity  (per settlement: the set of OTHER
//                                     settlements it can reach for trade via a
//                                     road-connected land path through
//                                     passage-permitting owners, OR via a shared
//                                     connected sea body when both have a port,
//                                     AND trade-rights hold)
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS AN ENGINE-APPROXIMATION. It models trade CONNECTIVITY and PARTNERS
// (CONFIRMED structure). The actual trade GOLD value the engine computes depends
// on distance, traded resources, route capacity, sea-lane length, blockades and
// tariff settings. We attach a per-link relative `value` (HYPOTHESIS, clearly
// labelled `valuesHypothesis` / UNVERIFIED) that REFINES a shorter-route-scores-
// higher distance decay by THREE more realistic signals (each bounded, centred
// near 1, neutral when data is missing — never fabricated):
//   • RESOURCE/TRADE-GOOD weight — partners holding rarer/higher trade-value
//     goods (descr_sm_resources `trade value`, placed via descr_strat) trade more.
//   • PORT/ROAD infrastructure multiplier — both-road and both-port links carry
//     more than a bare land hop (the engine rewards trade infrastructure).
//   • SETTLEMENT-SIZE weight — bigger markets (committedPopulation) trade more.
// It is STILL a relative proxy, NOT the engine's gold. "Can A trade with B, and
// roughly how valuable is that link relative to others?" is what this answers.
// Per settlement we also emit `tradeScoreHypothesis` (its total relative trade
// score) and `topPartnersHypothesis` (best partners by link value).
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

// ── Trade-good / resource weighting (HYPOTHESIS inputs) ───────────────────────
// RTW:R defines, per resource, a `tier` and a `trade value` (0-3) in
// data/descr_sm_resources.txt. Resources are PLACED on the map via descr_strat
// `resource <type>, <qty>, <x>, <y>; <RegionName>` lines. We read the resource
// CATALOGUE (tier + trade value) and the per-region PLACEMENTS, then give each
// region a `goodsValue` = Σ over its placed resources of (tradeValue · qty),
// plus a small bonus from the region's FARM LEVEL (FarmNN in descr_regions).
//
// CONFIRMED file layouts (read 2026-05-31 from C:\RIS\RIS\data):
//   descr_sm_resources.txt  (JSON-ish): each resource block is
//       "wine": { ... "tier": 3, "trade value": 1, ... }
//     → resourceName -> { tier:int, tradeValue:int(0..3) }.
//   descr_strat.txt resource lines:
//       resource        wine,                   4,           302,  395; Campania
//     i.e.  resource <type>, <quantity>, <x>, <y>; <RegionName>
//     The trailing `; RegionName` comment tags the owning region and is present
//     on ALL 5548 RIS lines (verified) and matches descr_regions region names;
//     we use it as the region key (the x,y are map-tile coords, not TGA pixels,
//     so the comment is the reliable, parser-cheap source).
//   descr_regions.txt per-region block (tab-indented), CONFIRMED column order:
//       1 RegionName / 2 Settlement / 3 owner faction / 4 rebel-people name /
//       5 "R G B" colour / 6 tag list (contains FarmNN, base_port_level_N,
//       rivertrade, mediterranean, terrain/climate/AOR) / 7 int (const 5) /
//       8 int (== the FarmNN level) / 9 culture line.
//     We read FarmNN from the line-6 tag list (the canonical farm level).
//
// NB All of this feeds the HYPOTHESIS relative `value` only — it is NOT the
// engine's gold formula.
function parseResourceCatalogue(modDataDir) {
  // returns { resourceName: { tier, tradeValue } }. Only the `"resources": [...]`
  // array carries trade values; later sections of the file (resource GROUPS,
  // terrain/AOR tag masks) also have quoted keys, so we (a) only scan inside the
  // top-level `"resources":` array and (b) keep only entries that actually have a
  // `"trade value"` — the real resource blocks all do; tag/group keys don't.
  const p = path.join(modDataDir, "descr_sm_resources.txt");
  const out = {};
  if (!fs.existsSync(p)) return out;
  const text = fs.readFileSync(p, "utf8");
  // strip ;; comments to avoid matching commented-out tiers
  const lines = text.split(/\r?\n/).map((l) => l.replace(/;.*$/, ""));
  let cur = null;
  for (const line of lines) {
    const head = line.match(/^\s*"([a-z_]+)"\s*:\s*$/);
    if (head) { cur = head[1]; if (!(cur in out)) out[cur] = { tier: null, tradeValue: null }; continue; }
    if (!cur) continue;
    const tier = line.match(/"tier"\s*:\s*(\d+)/);
    if (tier) out[cur].tier = +tier[1];
    const tv = line.match(/"trade value"\s*:\s*(\d+)/);
    if (tv) out[cur].tradeValue = +tv[1];
  }
  // Only the real resource blocks carry a `"trade value"`; later sections of the
  // file (resource GROUPS, terrain/AOR tag masks) reuse the quoted-key syntax but
  // have no trade value — drop them so the catalogue is exactly the trade goods.
  for (const k of Object.keys(out)) if (out[k].tradeValue == null) delete out[k];
  return out;
}

// Parse descr_strat resource lines → { regionName: [{ type, qty, tradeValue }] }.
function parseRegionResources(stratPath, catalogue) {
  const out = {};
  if (!stratPath || !fs.existsSync(stratPath)) return out;
  const text = fs.readFileSync(stratPath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    // resource <type>, <qty>, <x>, <y> ; RegionName
    const m = raw.match(/^\s*resource\s+([a-z_]+)\s*,\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*;\s*([A-Za-z][A-Za-z0-9_\-]*)/);
    if (!m) continue;
    const type = m[1], qty = +m[2], region = m[3];
    const tv = catalogue[type] ? (catalogue[type].tradeValue || 0) : 0;
    (out[region] ||= []).push({ type, qty, tradeValue: tv });
  }
  return out;
}

// Parse FarmNN per region from descr_regions tag list → { regionName: farmLevel }.
function parseRegionFarmLevels(regionsPath) {
  const out = {};
  if (!regionsPath || !fs.existsSync(regionsPath)) return out;
  const text = fs.readFileSync(regionsPath, "utf8");
  const lines = text.split(/\r?\n/);
  // walk blocks: a non-indented region name, then the tag list is the line that
  // contains a FarmNN token within the next few indented lines.
  let region = null, sinceRegion = 0;
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "");
    if (/^[A-Za-z]/.test(line)) { region = line.trim(); sinceRegion = 0; continue; }
    if (region) {
      sinceRegion++;
      const fm = line.match(/\bFarm(\d+)\b/);
      if (fm) { out[region] = +fm[1]; region = null; }
      else if (sinceRegion > 8) region = null; // tag list is ~line 6; give up after
    }
  }
  return out;
}

// Combine resource placements + farm level into a per-region relative goods
// score (HYPOTHESIS). goodsValue = Σ(tradeValue·qty) over placed resources +
// FARM_WEIGHT·farmLevel. tradeValue is 0..3, qty typically 1..6, farmLevel ~5..13.
const FARM_WEIGHT = 0.5; // farming contributes modestly to tradeable surplus (HYP)
function buildRegionGoods(regionResources, regionFarm) {
  const out = {}; // region -> { goodsValue, resourceTradeSum, farmLevel, resources:[type] }
  const regions = new Set([...Object.keys(regionResources), ...Object.keys(regionFarm)]);
  for (const region of regions) {
    const res = regionResources[region] || [];
    let resourceTradeSum = 0;
    const types = [];
    for (const r of res) { resourceTradeSum += (r.tradeValue || 0) * (r.qty || 1); types.push(r.type); }
    const farmLevel = regionFarm[region] != null ? regionFarm[region] : null;
    const goodsValue = resourceTradeSum + (farmLevel != null ? FARM_WEIGHT * farmLevel : 0);
    out[region] = { goodsValue, resourceTradeSum, farmLevel, resources: types };
  }
  return out;
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

  // Region centroids (pixel-space, for the HYPOTHESIS trade-value decay only).
  const sumX = new Map(), sumY = new Map(), cnt = new Map();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cell[y * W + x];
      if (c < 0) continue;
      sumX.set(c, (sumX.get(c) || 0) + x);
      sumY.set(c, (sumY.get(c) || 0) + y);
      cnt.set(c, (cnt.get(c) || 0) + 1);
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

  const centroids = {};      // regionName -> [x, y] pixel centroid
  for (const [idx, n] of cnt) {
    if (!n) continue;
    centroids[regionNames[idx]] = [sumX.get(idx) / n, sumY.get(idx) / n];
  }

  return {
    W, H,
    regionNames,
    adjacency,             // land-adjacency graph
    regionSeas,            // region -> sea bodies (coastline)
    seaToRegions,          // sea body -> coastal regions
    centroids,             // region -> [x,y] (HYPOTHESIS trade-value decay only)
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
// Cross-faction trade requires trade RIGHTS. TRADE-NETWORK V2 GATE (2026-06-01):
// a directed pair A→B has trade rights when
//
//   STATE != WAR  AND  ( bond>=54  OR  state==allied(rel199)  OR  bond>6 )
//
// mapped to the cracked diplomacy matrix cell (see provincia-diplomacy-matrix-
// cracked: +12 STATE, +20 BOND, +24 aggression) per directed entry in the
// per-faction `rel[]` array {to, att(=STATE), bond, agg}:
//
//   • WAR EXCLUSION — att>=600 is AT WAR (CONFIRMED: 600↔faction_relationships
//     201, 99.9% on clean saves). A pair at war NEVER trades, even if a stale
//     bond byte lingers. (The old gating never explicitly excluded war; in
//     practice trade/allied lists already exclude war columns, but V2 makes the
//     exclusion explicit and data-driven off rel[].)
//   • bond>=54  — MILITARY BOND. 54=ally/client, 55=suzerain. CONFIRMED: alliance
//     /protectorate, always carries trade rights. (matrix +20)
//   • state==allied (att==0) — the descr_strat `faction_relationships` 199 ally
//     state. CONFIRMED present; in EVERY observed save (julii/Carthage/Athens/RoR
//     T1-3) att==0 co-occurs with bond>=54, so this branch never fires alone on
//     the corpus — kept for robustness (a future save could carry rel199+bond6).
//   • bond>6 (and <54) — a PARTIAL alliance bond on a NON-allied (neutral) state:
//     the trade-rights / non-aggression pact the bond>=54-only gating missed.
//     CONFIRMED on save_julii3 / save_carthage3 (T3): achaea↔elis carry att=200
//     (neutral) + bond=38 + turnsAllied=1 — a real partial bond the engine is
//     counting as an allied-turn. THIS is the case V2 folds in. (bond==6 is the
//     "none" floor and does NOT grant rights — the task's "alliance-bond>=6" is
//     read as a NON-DEFAULT bond, i.e. bond>6, since 6 is the universal default.)
//
// rel[] excludes the neutral-default (att==200 && bond==6) cells, so iterating it
// is exactly the cross-faction trade-candidate set. When the matrix did NOT lock
// (rel[] absent), we fall back to the precomputed `trade` (bond>=54) + `allied`
// (att==0) lists, which carry the same information minus the bond>6 partial case.
//
// Additionally, the descr_strat `faction_relationships` 199-ally pairs are taken
// as a live-INDEPENDENT floor (so gating works with NO parsed matrix — the
// non-live path — and matches the campaign's STARTING trade rights). Own-faction
// trade always allowed.
//
// Returns a gate function with a `.stats` property recording how many directed
// pairs each branch admitted (for [trade]-tagged diagnostics).
const TRADE_BOND_ALLY = 54;     // CONFIRMED: military alliance/client bond floor
const TRADE_BOND_NONE = 6;      // CONFIRMED: "no bond" default; >6 == a real bond
const TRADE_STATE_WAR = 600;    // CONFIRMED: att>=600 == at war (rel 201)
function buildTradeRights(diplomacy, stratRelationships) {
  // returns (factionA, factionB) -> bool  (A permits trade with B)
  const partners = {}; // factionLower -> Set(partnerLower)
  const stats = { rel: 0, bond54: 0, allied: 0, partialBond: 0, warExcluded: 0, fallbackList: 0, stratFloor: 0, matrixUsed: false };
  const add = (a, b) => {
    a = String(a).toLowerCase(); b = String(b).toLowerCase();
    (partners[a] ||= new Set()).add(b);
  };
  if (diplomacy) {
    for (const [name, rec] of Object.entries(diplomacy)) {
      if (name === "_meta" || !rec) continue;
      const a = name.toLowerCase();
      partners[a] ||= new Set();
      if (Array.isArray(rec.rel) && rec.rel.length) {
        // PRIMARY V2 path: gate per directed pair off the raw matrix fields.
        stats.matrixUsed = true;
        for (const e of rec.rel) {
          if (!e || !e.to) continue;
          stats.rel++;
          const att = +e.att, bond = +e.bond;
          if (Number.isFinite(att) && att >= TRADE_STATE_WAR) { stats.warExcluded++; continue; } // WAR: never
          let admit = false;
          if (Number.isFinite(bond) && bond >= TRADE_BOND_ALLY) { admit = true; stats.bond54++; }      // military bond
          else if (att === 0) { admit = true; stats.allied++; }                                        // allied state (rel199)
          else if (Number.isFinite(bond) && bond > TRADE_BOND_NONE) { admit = true; stats.partialBond++; } // partial bond pact
          if (admit) add(a, e.to);
        }
      } else {
        // FALLBACK (matrix didn't lock for this faction): precomputed lists.
        // These already exclude war columns, but cannot surface the bond>6 case.
        if (Array.isArray(rec.trade))  for (const p of rec.trade)  { add(a, p); stats.fallbackList++; } // bond>=54
        if (Array.isArray(rec.allied)) for (const p of rec.allied) { add(a, p); stats.fallbackList++; } // att==0
      }
    }
  }
  // live-independent floor: descr_strat faction_relationships 199-ally pairs.
  // shape: { fromFactionLower: [{ to, kind }] }, kind in {"ally","war"}.
  if (stratRelationships) {
    for (const [from, arr] of Object.entries(stratRelationships)) {
      if (!Array.isArray(arr)) continue;
      for (const e of arr) if (e && e.kind === "ally") { add(from, e.to); stats.stratFloor++; }
    }
  }
  const gate = (a, b) => {
    if (!a || !b) return false;
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return true;                       // own faction always trades
    const sa = partners[a];
    return !!(sa && sa.has(b));                     // trade rights A->B
  };
  gate.stats = stats;
  return gate;
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
//     always; cross-faction requires trade rights — bond or allied state).
//
// ── TRADE-VALUE estimate (HYPOTHESIS — UNVERIFIED, NOT engine gold) ────────────
// As a FIRST CUT, each link also carries a relative `value` in (0,1]: a distance-
// DECAYED score where SHORTER routes score higher. This is an APPROXIMATION of the
// real-world intuition that the engine values nearer trade partners more (shorter
// caravan/sea legs, lower attrition). It is NOT the engine's trade-gold formula —
// that also depends on traded resources, route capacity, settlement size, tariffs
// and blockades, none of which are modelled here. Distances:
//   • LAND: BFS hop-distance (number of region borders crossed) from the origin
//     region to the partner region within the road-connected component. value =
//     1/(1+hops)  →  adjacent regions ~0.5, far ones decay toward 0.
//   • SEA : Euclidean distance between region pixel-centroids, normalised by the
//     map diagonal. value = exp(-k * normDist) with k = SEA_DECAY_K. (A straight-
//     line proxy for sea-lane length; it ignores coastline detour, hence approx.)
// A settlement reachable by BOTH land and sea takes the MAX of the two link
// values (the better channel). All values are clearly labelled HYPOTHESIS.
//
// Output: name -> { faction, region, road, seaPort, partners:[names],
//   landPartners:[names], seaPartners:[names],
//   valuesHypothesis:{partnerName: score}  // UNVERIFIED relative decay }.
const SEA_DECAY_K = 6; // tuning constant for the sea distance decay (HYPOTHESIS)

// ── HYPOTHESIS value-refinement weights (all UNVERIFIED, relative-only) ────────
// A link's refined value = baseDecay · partnerGoodsFactor · infraMult · popMult.
//   • partnerGoodsFactor: rarer/higher-value trade goods at BOTH endpoints →
//     more to exchange. Uses the geometric mean of the two regions' goodsValue
//     mapped through 1 + GOODS_GAIN·tanh(g/GOODS_SCALE) so it stays bounded.
//   • infraMult: both endpoints road-connected and/or ported → the engine
//     rewards trade infrastructure; apply a modest multiplier.
//   • popMult: bigger markets trade more; weight by the geometric mean of the
//     two settlements' committedPopulation, bounded.
// Each factor is centred near 1 so a bare/poor link ≈ the old pure-decay value
// and a rich coastal hub link scores meaningfully higher — RELATIVE ordering
// only, NOT engine gold.
const GOODS_GAIN = 0.6, GOODS_SCALE = 6;    // goods bounded boost up to ~1.6×
const INFRA_BOTH_ROAD = 1.15;               // both endpoints on the road net
const INFRA_BOTH_PORT = 1.25;               // both endpoints sea-ported
const POP_GAIN = 0.5, POP_SCALE = 8000;     // population bounded boost up to ~1.5×
function computeTradeConnectivity(geometry, settlements, ownerByCity, region2settlement, settlement2region, flags, tradeRights, regionGoods, popByCity) {
  const { adjacency, regionSeas, seaToRegions, centroids } = geometry;
  regionGoods = regionGoods || {};
  popByCity = popByCity || {};
  const goodsValOf = (region) => {
    const g = region && regionGoods[region];
    return g && g.goodsValue != null ? g.goodsValue : null;
  };
  // bounded goods factor for a LINK from region rA to region rB (geom-mean):
  const goodsFactor = (rA, rB) => {
    const a = goodsValOf(rA), b = goodsValOf(rB);
    if (a == null || b == null) return 1;        // no data → neutral (no fabrication)
    const g = Math.sqrt(Math.max(0, a) * Math.max(0, b));
    return 1 + GOODS_GAIN * Math.tanh(g / GOODS_SCALE);
  };
  const popFactor = (cityA, cityB) => {
    const a = popByCity[cityA], b = popByCity[cityB];
    if (a == null || b == null) return 1;        // no data → neutral
    const p = Math.sqrt(Math.max(0, a) * Math.max(0, b));
    return 1 + POP_GAIN * Math.tanh(p / POP_SCALE);
  };
  const mapDiag = Math.hypot(geometry.W || 1, geometry.H || 1) || 1;
  const seaDist = (rA, rB) => {
    const a = centroids && centroids[rA], b = centroids && centroids[rB];
    if (!a || !b) return null;
    return Math.hypot(a[0] - b[0], a[1] - b[1]) / mapDiag; // 0..~1
  };

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
    const res = { comp, components, nodeSet };
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
    const valuesHypothesis = {}; // partnerName -> relative decayed score (UNVERIFIED)
    const bump = (t, v) => { if (!(t in valuesHypothesis) || v > valuesHypothesis[t]) valuesHypothesis[t] = +v.toFixed(4); };
    const myGoods = goodsValOf(region);

    // Refine a base distance-decay into the HYPOTHESIS link value by folding in
    // the partner's trade goods, shared infrastructure, and market sizes. Each
    // factor is bounded & centred near 1 (no fabrication when data is missing).
    const refine = (baseDecay, partnerCity, partnerRegion, channel) => {
      let v = baseDecay;
      v *= goodsFactor(region, partnerRegion);          // resource/trade-good weight
      v *= popFactor(name, partnerCity);                // settlement-size weight
      const pf = flags[partnerCity] || {};
      if (channel === "land" && f.road && pf.road) v *= INFRA_BOTH_ROAD; // both on road net
      if (channel === "sea"  && f.seaPort && pf.seaPort) v *= INFRA_BOTH_PORT; // both ported
      return v;
    };

    // LAND: only if this settlement has a road and its region permits its own
    // faction (it always does) — find its land component for its own faction.
    // BFS from the origin region within the component to get hop-distance.
    if (f.road && region && faction) {
      const { comp, nodeSet } = landComponentsFor(faction);
      const cid = comp.get(region);
      if (cid !== undefined && nodeSet.has(region)) {
        const dist = new Map([[region, 0]]);
        const q = [region];
        while (q.length) {
          const r = q.shift();
          const d = dist.get(r);
          for (const nb of (adjacency[r] || [])) {
            if (nodeSet.has(nb) && !dist.has(nb)) { dist.set(nb, d + 1); q.push(nb); }
          }
        }
        for (const [r, hops] of dist) {
          const t = region2settlement[r];
          if (!t || t === name) continue;
          const owner = factionOf(t);
          if (owner && tradeRights(faction, owner)) {
            landPartners.add(t);
            // HYPOTHESIS: shorter land path = higher base, refined by goods+infra+pop
            bump(t, refine(1 / (1 + hops), t, r, "land"));
          }
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
        if (owner && faction && tradeRights(faction, owner)) {
          seaPartners.add(t);
          const nd = seaDist(region, r); // 0..~1 normalised straight-line proxy
          if (nd != null) bump(t, refine(Math.exp(-SEA_DECAY_K * nd), t, r, "sea")); // HYP
        }
      }
    }

    const partners = new Set([...landPartners, ...seaPartners]);
    // Per-settlement relative trade-SCORE (HYPOTHESIS): sum of its link values,
    // nudged by its OWN goods endowment (a settlement with valuable goods is a
    // better hub even before counting partners). UNVERIFIED, relative-only.
    let linkSum = 0;
    for (const v of Object.values(valuesHypothesis)) linkSum += v;
    const ownGoodsFactor = myGoods != null ? 1 + GOODS_GAIN * Math.tanh(myGoods / GOODS_SCALE) : 1;
    const tradeScoreHypothesis = +(linkSum * ownGoodsFactor).toFixed(4);
    // top partners by HYPOTHESIS link value (descending)
    const topPartnersHypothesis = Object.entries(valuesHypothesis)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([partner, value]) => ({ partner, value }));
    const rg = region ? regionGoods[region] : null;
    result[name] = {
      faction,
      region,
      road: !!f.road,
      seaPort: !!f.seaPort,
      riverPort: !!f.riverPort,
      committedPopulation: popByCity[name] != null ? popByCity[name] : null,
      goodsValueHypothesis: rg ? +rg.goodsValue.toFixed(3) : null, // region trade-good endowment (HYP input)
      resources: rg ? rg.resources : [],                            // placed trade goods (descr_strat)
      farmLevel: rg ? rg.farmLevel : null,                          // FarmNN (descr_regions)
      landPartners: [...landPartners].sort(),
      seaPartners: [...seaPartners].sort(),
      partners: [...partners].sort(),
      valuesHypothesis,            // UNVERIFIED per-link relative value (decay×goods×infra×pop)
      tradeScoreHypothesis,        // UNVERIFIED per-settlement total relative trade-score
      topPartnersHypothesis,       // UNVERIFIED top partners by link value
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

  // descr_strat faction_relationships 199-ally pairs = live-independent trade-
  // rights floor (so gating works even if the matrix didn't lock, and matches the
  // campaign's STARTING trade rights). Best-effort: parse only if available.
  let stratRelationships = null;
  try {
    const { parseDescrStratFactionRelationships } = require("./parsers.js");
    const stratPath = path.join(
      modDataDir, "world", "maps", "campaign", opts.campaign || "imperial_campaign", "descr_strat.txt"
    );
    if (fs.existsSync(stratPath)) {
      stratRelationships = parseDescrStratFactionRelationships(fs.readFileSync(stratPath, "utf8"));
    }
  } catch { /* optional floor — ignore if parser/file unavailable */ }

  const tradeRights = buildTradeRights(cr.diplomacy, stratRelationships);

  // [trade] partner-gating diagnostics (provincia.log is the main diagnosis
  // window; see provincia-feature-logging). Works in BOTH live and non-live:
  //   • LIVE  (matrix locked)  → matrixUsed=true; per-branch counts populated.
  //   • NON-LIVE (no matrix)   → matrixUsed=false, rel=0; gating rides the
  //     descr_strat 199-ally floor (stratFloor) — degrade+log, never silent.
  const grs = tradeRights.stats || {};
  const matrixLocked = !!(cr.diplomacy && cr.diplomacy._meta);
  try {
    if (!matrixLocked && !grs.stratFloor) {
      // eslint-disable-next-line no-console
      console.log("[trade] gating UNAVAILABLE — no diplomacy matrix AND no descr_strat ally floor; cross-faction trade will be EMPTY (own-faction only).");
    } else {
      // eslint-disable-next-line no-console
      console.log(`[trade] gating basis=${matrixLocked ? "matrix(rel[])" : "descr_strat-floor"} matrixUsed=${grs.matrixUsed} relPairs=${grs.rel || 0} → admit{bond>=54=${grs.bond54 || 0}, alliedState=${grs.allied || 0}, partialBond(6<bond<54)=${grs.partialBond || 0}} warExcluded=${grs.warExcluded || 0} fallbackList=${grs.fallbackList || 0} stratFloor=${grs.stratFloor || 0}`);
    }
  } catch { /* logging must never break the parse */ }

  // ── HYPOTHESIS value inputs: trade goods + farm level + population ──────────
  // Resource catalogue (tier/trade value) and per-region placements come from
  // the mod data; the engine LOADS the override descr_strat, so prefer it
  // (findCampaignDescrStrat) for resource placements.
  let regionGoods = {};
  try {
    const { findCampaignDescrStrat } = require("./ownershipParser.js");
    const catalogue = parseResourceCatalogue(modDataDir);
    const goodsStratPath = findCampaignDescrStrat(modDataDir) ||
      path.join(modDataDir, "world", "maps", "campaign", opts.campaign || "imperial_campaign", "descr_strat.txt");
    const regionResources = parseRegionResources(goodsStratPath, catalogue);
    const regionFarm = parseRegionFarmLevels(regionsPath);
    regionGoods = buildRegionGoods(regionResources, regionFarm);
  } catch { /* HYPOTHESIS inputs are optional — neutral factors if unavailable */ }

  // committedPopulation per settlement (start-of-turn market size) from crackSave.
  const popByCity = {};
  for (const [city, sf] of Object.entries(cr.settlementFields || {})) {
    if (sf && sf.committedPopulation != null) popByCity[city] = sf.committedPopulation;
  }

  const trade = computeTradeConnectivity(
    geometry, settlements, cr.ownerByCity || {}, region2settlement, settlement2region, flags, tradeRights,
    regionGoods, popByCity
  );

  // rollup stats
  let withRoad = 0, withSeaPort = 0, withRiverPort = 0;
  for (const v of Object.values(flags)) { if (v.road) withRoad++; if (v.seaPort) withSeaPort++; if (v.riverPort) withRiverPort++; }
  let totalPartnerLinks = 0, isolated = 0, landLinks = 0, seaLinks = 0;
  for (const v of Object.values(trade.settlements)) {
    totalPartnerLinks += v.partners.length;
    landLinks += v.landPartners.length;   // directed; both endpoints emit one
    seaLinks += v.seaPartners.length;
    if (v.partners.length === 0) isolated++;
  }
  let regionsWithGoods = 0, settlementsWithPop = 0;
  for (const g of Object.values(regionGoods)) if (g && g.goodsValue > 0) regionsWithGoods++;
  settlementsWithPop = Object.keys(popByCity).length;

  // value-estimate basis (item 3): which inputs actually fed the distance-decay
  // refinement — so a degraded run (missing goods/pop) is visible in the log.
  const valueBasis = [
    "distance-decay(land=1/(1+hops), sea=exp(-k·centroidDist))",
    regionsWithGoods ? "goods" : "goods=NONE",
    settlementsWithPop ? "population" : "population=NONE",
    "infra",
  ].join("+");
  try {
    // eslint-disable-next-line no-console
    console.log(`[trade] connectivity: settlements=${Object.keys(trade.settlements).length} withRoad=${withRoad} withSeaPort=${withSeaPort} landLinks=${landLinks} seaLinks=${seaLinks} isolated=${isolated} avgPartners=${(totalPartnerLinks / Math.max(1, Object.keys(trade.settlements).length)).toFixed(2)}`);
    // eslint-disable-next-line no-console
    console.log(`[trade] value-estimate basis=${valueBasis} (HYPOTHESIS, relative-only — NOT engine gold); regionsWithGoods=${regionsWithGoods} settlementsWithPop=${settlementsWithPop}`);
    if (isolated === Object.keys(trade.settlements).length && Object.keys(trade.settlements).length > 0) {
      // eslint-disable-next-line no-console
      console.log("[trade] WARNING: ALL settlements isolated (0 partners) — check geometry/flags/gating; trade network is EMPTY.");
    }
  } catch { /* logging must never break the parse */ }

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
      landLinks,                 // directed land trade links (both endpoints emit)
      seaLinks,                  // directed sea trade links
      avgPartnersPerSettlement: +(totalPartnerLinks / Math.max(1, Object.keys(trade.settlements).length)).toFixed(2),
      regionsWithGoods,          // HYPOTHESIS input coverage: regions with a goods value
      settlementsWithPopulation: settlementsWithPop, // HYP input coverage: pop-weighted markets
      gating: {                  // V2 partner-gating branch counts (see buildTradeRights)
        basis: matrixLocked ? "matrix" : "descr_strat-floor",
        matrixUsed: !!grs.matrixUsed,
        relPairs: grs.rel || 0,
        admitBond54: grs.bond54 || 0,
        admitAlliedState: grs.allied || 0,
        admitPartialBond: grs.partialBond || 0,
        warExcluded: grs.warExcluded || 0,
        fallbackList: grs.fallbackList || 0,
        stratFloor: grs.stratFloor || 0,
      },
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
  parseResourceCatalogue,
  parseRegionResources,
  parseRegionFarmLevels,
  buildRegionGoods,
  ROAD_CHAIN,
  SEA_PORT_CHAINS,
  RIVER_PORT_CHAINS,
};
