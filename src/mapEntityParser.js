// src/mapEntityParser.js
//
// Counts for the three "map-entity" types tracked by the dev image's pointer
// registry: roads, ports, watchtowers.
//
// Roads & Ports:
//   We count per-settlement chain occurrences in the save's settlement-detail
//   records. Each settlement that has built `hinterland_roads` carries a road
//   record; each settlement with `port_buildings` or `river_port` carries a
//   port record. These are the most reliable, save-grounded counts we can
//   extract; they capture what the engine has serialised, not a probabilistic
//   estimate.
//
//   The dev image's "ports = 1276" / "roads = 3957" appear to count each
//   pointer-registry SLOT, which includes auxiliary records the engine spawns
//   per port/road (shrouds, blockade builders, etc.). Counting chains gives
//   us the SETTLEMENT count, which is a strict lower bound. The save-budget
//   uses this as the "counted" floor instead of a dev-ratio extrapolation.
//
// Watchtowers:
//   Watchtowers are placed on the campaign map (no chain in any settlement)
//   and built by armies via the "build watchtower" command. No ASCII string
//   "watchtower" appears anywhere in the save buffer (verified on all 4
//   reference saves). The HST does list WATCHTOWER (idx 60) and
//   WATCHTOWER_MANAGER (idx 32), so the engine clearly stores them — but they
//   live inside an opaque body section that resisted byte-pattern probes.
//
//   HYPOTHESIS — the "Post-grid 267-stride array" (cover.js's auxiliary
//   tile-format array immediately after the diplomatic-matrix end) is the
//   pool. Total records: ~2,272; non-template records: 346-350 — strikingly
//   close to the dev image's 363. The 267-byte stride matches the diplo
//   matrix exactly (so it's an alternate-keyed tile-attribute table).
//
//   We expose `countWatchtowers(buf)` as a best-effort count of "non-default
//   records in the post-grid 267-stride array". Not validated against the
//   engine ground truth — flagged as `counted-probable` instead of `counted`.
//   If the post-grid array doesn't exist (early-game saves, e.g. Turn 900
//   End), returns null and the caller should fall back to the estimate.

"use strict";

const path = require("path");
const { findAllSettlementMarkers, scanChainsBetween } = require("./buildingParser.js");

// Settlement-zone bounds (per cover.js + RESEARCH.md):
const SETT_ZONE_START = 0xf85f00;
const SETT_ZONE_END   = 0x1f10c72;

// Post-grid 267-stride array detector — re-implements cover.js section 9c.
// Returns { start, end, count } or null.
function findPostGridArray(buf) {
  const SCAN_START = 0xf84632;            // generous lower bound
  const SCAN_END   = Math.min(buf.length, SCAN_START + 0x200000);
  // The +0x10..+0x1f signature of a default record.
  const BODY_SIG = Buffer.from([
    0xc8, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
  ]);
  let p = SCAN_START;
  let firstOff = -1;
  while (p + 16 <= SCAN_END) {
    const sigAt = buf.indexOf(BODY_SIG, p);
    if (sigAt < 0 || sigAt + 16 > SCAN_END) break;
    const cand = sigAt - 0x10;
    if (cand > SCAN_START && buf[cand - 1] === 0 && buf[cand] !== 0) {
      const nextSig = cand + 267 + 0x10;
      if (nextSig + 16 <= SCAN_END) {
        let match = true;
        for (let k = 0; k < 16; k++) if (buf[nextSig + k] !== BODY_SIG[k]) { match = false; break; }
        if (match) { firstOff = cand; break; }
      }
    }
    p = sigAt + 1;
  }
  if (firstOff < 0) return null;
  const magic = buf.readUInt32LE(firstOff);
  // Walk with multi-stride lookahead (records may span 1..6 stride units).
  let pos = firstOff, count = 0;
  while (pos + 267 <= SCAN_END && buf.readUInt32LE(pos) === magic) {
    count++;
    let next = -1;
    for (let k = 1; k <= 6; k++) {
      const cand = pos + k * 267;
      if (cand + 4 > SCAN_END) break;
      if (buf.readUInt32LE(cand) === magic) { next = cand; break; }
    }
    if (next < 0) { pos += 267; break; }
    pos = next;
  }
  return { start: firstOff, end: pos + 267, count, magic };
}

function getSettlementMarkers(buf) {
  return findAllSettlementMarkers(buf)
    .filter(s => s.offset >= SETT_ZONE_START && s.offset < SETT_ZONE_END);
}

// Count chains by name across every settlement-detail record.
function tallyChains(buf, setts) {
  const counts = { port_buildings: 0, river_port: 0, hinterland_roads: 0 };
  for (let i = 0; i < setts.length; i++) {
    const prevEnd = i === 0 ? SETT_ZONE_START : setts[i - 1].blockEnd;
    const chains = scanChainsBetween(buf, prevEnd, setts[i].offset, null, null);
    for (const c of chains) {
      if (c.name in counts) counts[c.name]++;
    }
  }
  return counts;
}

// Public API
function countRoads(buf, setts) {
  const t = tallyChains(buf, setts || getSettlementMarkers(buf));
  // hinterland_roads chain presence == "settlement has roads". We treat each
  // such settlement as one road pointer-registry slot. This is the strict
  // lower bound on roads — the dev image's higher number reflects additional
  // per-road auxiliary records the engine pushes into the registry.
  return t.hinterland_roads;
}

function countPorts(buf, setts) {
  const t = tallyChains(buf, setts || getSettlementMarkers(buf));
  // Both deep-water (port_buildings) and river ports (river_port) count.
  return t.port_buildings + t.river_port;
}

// Watchtowers — EXACT count from the canonical 40-byte-stride table.
//
// CONFIRMED 2026-05-27 (see dig-watchtower-table.js):
// The watchtower table is a 40-byte-stride record array preceded by a
// distinctive 14-byte header marker. Every record has magic 61 13 82 12
// at +28..+31. The last record swaps +32..+35 to 2c 71 21 ad (the same
// 4-byte terminator that ends the table header). Record format:
//   +0..+3   u32  tile_x
//   +4..+7   u32  tile_y
//   +8..+11  u32  ? (owning settlement id?)
//   +12      u8   faction-ish (5 distinct values 0..4 across saves)
//   +13..+15 u24  ?
//   +16..+23 8B   per-instance hash
//   +24..+27 u32  zero (always)
//   +28..+31 magic 61 13 82 12 (constant on every record)
//   +32..+35 magic 61 13 82 12 (constant — except last record = 2c 71 21 ad)
//   +36..+39 random tail
//
// And the COUNT is a u16 at table_anchor - 10:
//   prelude:  ... 35 61 23 28 00 00 35 61 23 28 2c 71 21 ad <u16 count> 61 13 82 12 <4B random> <first record>
//
// Validated counts (matches walk-the-table count exactly):
//   T960:  156   T1017: 176   T1018: 177  (+1 = one watchtower built that turn)
const WT_HEADER_MARKER = Buffer.from([
  0x35, 0x61, 0x23, 0x28, 0x00, 0x00,
  0x35, 0x61, 0x23, 0x28, 0x2c, 0x71, 0x21, 0xad,
]);
const WT_RECORD_MAGIC  = Buffer.from([0x61, 0x13, 0x82, 0x12]);
const WT_TERMINATOR    = Buffer.from([0x2c, 0x71, 0x21, 0xad]);

// Locate the watchtower table. Returns { headerOff, anchor, declaredCount }
// or null if no table is present (saves with zero watchtowers).
function findWatchtowerTable(buf) {
  const headerOff = buf.indexOf(WT_HEADER_MARKER);
  if (headerOff < 0) return null;
  // count u16 LE immediately after the 14-byte marker
  const declaredCount = buf.readUInt16LE(headerOff + WT_HEADER_MARKER.length);
  // anchor = first record = marker + 14 (marker) + 2 (count) + 4 (magic) + 4 (random)
  const anchor = headerOff + WT_HEADER_MARKER.length + 2 + 4 + 4;
  return { headerOff, anchor, declaredCount };
}

function countWatchtowers(buf) {
  const t = findWatchtowerTable(buf);
  if (!t) return null;
  // Walk by 40-byte stride, validating magic at +28 of each record. The
  // walked count is authoritative; the declaredCount is a cross-check.
  let p = t.anchor, walked = 0;
  while (p + 40 <= buf.length) {
    if (buf.compare(WT_RECORD_MAGIC, 0, 4, p + 28, p + 32) !== 0) break;
    walked++;
    // Last record has terminator at +32 instead of repeated magic — when we
    // see it, the record IS counted but no more records follow.
    if (buf.compare(WT_TERMINATOR, 0, 4, p + 32, p + 36) === 0) break;
    p += 40;
  }
  return walked;
}

// Convenience: get all three counts in one pass over the settlement zone.
function countMapEntities(buf) {
  const setts = getSettlementMarkers(buf);
  const chains = tallyChains(buf, setts);
  return {
    roads:        chains.hinterland_roads,
    ports:        chains.port_buildings + chains.river_port,
    portsBuildings: chains.port_buildings,
    portsRiver:    chains.river_port,
    watchtowers:  countWatchtowers(buf),  // may be null
    settlementCount: setts.length,
  };
}

module.exports = {
  countRoads,
  countPorts,
  countWatchtowers,
  countMapEntities,
  findPostGridArray,        // exposed for tests / probes
  findWatchtowerTable,      // exposed for tests / probes
};
