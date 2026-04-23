// src/saveOwnershipParser.js
//
// Extracts current settlement ownership from a .sav file by reading the
// per-settlement "owner faction UUID" (4 bytes). The byte-offset of this
// field relative to the settlement name marker differs between vanilla
// and mods:
//   - Vanilla Rome Remastered: d = -454
//   - RIS mod: d = -1944
// So we DYNAMICALLY detect the offset using descr_strat ground truth:
// we pick the offset where settlements with the same descr_strat faction
// share the same uint32 value, most consistently.
//
// Once we have the offset + a UUID→faction dictionary:
//   - For each settlement, read its uint32 UUID
//   - Look up UUID in dictionary → current owning faction
// This correctly reports conquered settlements' NEW owner because the
// dictionary is built from majority-vote across all settlements.

"use strict";

const { findAllSettlementMarkers } = require("./buildingParser.js");

// Scan candidate offsets and pick the one where settlements with same
// descr_strat faction share the same uint32 value.
// Returns { bestOffset, score } where score = # of settlements cleanly mapped.
function detectOwnerOffset(buf, setts, initialOwnerByCity) {
  // Try known-good offsets first (from reverse engineering):
  //   d=-454 → vanilla 32-bit owner UUID
  //   d=-1944/-1946 → RIS mod 32-bit owner UUID
  // Otherwise scan.
  const CANDIDATES_FIRST = [-454, -456, -1944, -1946];
  const SCAN = [-3500, -100];
  const tried = new Set();
  const allOffsets = [...CANDIDATES_FIRST, ...(function* () {
    for (let d = SCAN[0]; d <= SCAN[1]; d++) yield d;
  })()];

  // For a given offset, compute (score, factionsMatching) where:
  //   score = total # settlements whose UUID occurs ≥2 times AND belongs to
  //           a UUID whose dominant faction includes this settlement's descr_strat.
  // Also return: # of distinct UUIDs that cleanly map to one faction.
  function evaluate(d) {
    const uuidToFac = new Map();
    const uuidCount = new Map();
    for (const s of setts) {
      const o = s.offset + d;
      if (o < 0 || o + 4 > buf.length) continue;
      const v = buf.readUInt32LE(o);
      if (v === 0 || v === 0xffffffff) continue;
      uuidCount.set(v, (uuidCount.get(v) || 0) + 1);
      const fac = initialOwnerByCity[s.name];
      if (!fac) continue;
      if (!uuidToFac.has(v)) uuidToFac.set(v, new Map());
      const fm = uuidToFac.get(v);
      fm.set(fac, (fm.get(fac) || 0) + 1);
    }
    let cleanUuidCount = 0;
    for (const [v, fm] of uuidToFac) {
      if ((uuidCount.get(v) || 0) < 2) continue;
      const top = Math.max(...fm.values());
      const total = [...fm.values()].reduce((a, b) => a + b, 0);
      if (top / total >= 0.5) cleanUuidCount++;
    }
    let score = 0;
    for (const s of setts) {
      const fac = initialOwnerByCity[s.name];
      if (!fac) continue;
      const o = s.offset + d;
      if (o < 0 || o + 4 > buf.length) continue;
      const v = buf.readUInt32LE(o);
      if (v === 0 || v === 0xffffffff) continue;
      if ((uuidCount.get(v) || 0) < 2) continue;
      const fmap = uuidToFac.get(v);
      if (!fmap) continue;
      const top = Math.max(...fmap.values());
      const total = [...fmap.values()].reduce((a, b) => a + b, 0);
      if (top / total >= 0.5 && (fmap.get(fac) || 0) > 0) score++;
    }
    return { score, cleanUuidCount };
  }

  let best = { d: null, score: 0, cleanUuidCount: 0 };
  for (const d of allOffsets) {
    if (tried.has(d)) continue;
    tried.add(d);
    const r = evaluate(d);
    // Bias: known-good offsets get a small boost. They were verified manually
    // and any tie should resolve in their favor.
    // Strongly prefer known-good offsets (verified manually via reverse engineering).
    // Other offsets that score higher are typically related fields like
    // numeric faction-ID or an "owned" flag that don't actually identify the owning
    // faction (e.g. uninitialized rebel settlements zero out the wrong way).
    const knownBoost = CANDIDATES_FIRST.includes(d) ? 100 : 0;
    const adjScore = r.score + knownBoost;
    if (adjScore > best.score) best = { d, ...r, score: adjScore };
  }
  return best;
}

// Build UUID → faction dictionary using descr_strat majority vote at given offset.
// Returns Map<uuid_u32, factionId_string>.
function buildUuidToFaction(buf, setts, offset, initialOwnerByCity) {
  const uuidToFac = new Map();
  for (const s of setts) {
    const fac = initialOwnerByCity[s.name];
    if (!fac) continue;
    const o = s.offset + offset;
    if (o < 0 || o + 4 > buf.length) continue;
    const v = buf.readUInt32LE(o);
    if (v === 0 || v === 0xffffffff) continue;
    if (!uuidToFac.has(v)) uuidToFac.set(v, new Map());
    const fm = uuidToFac.get(v);
    fm.set(fac, (fm.get(fac) || 0) + 1);
  }
  // Collapse to majority faction per UUID
  const dict = new Map();
  for (const [uuid, fmap] of uuidToFac) {
    const entries = [...fmap.entries()].sort((a, b) => b[1] - a[1]);
    const [topFac, topCount] = entries[0];
    const total = [...fmap.values()].reduce((a, b) => a + b, 0);
    // Require 60%+ majority to trust this UUID→faction mapping
    if (topCount / total >= 0.6) dict.set(uuid, topFac);
  }
  return dict;
}

// For each settlement, read its current owner UUID and resolve to faction.
// Returns { ownerByCity: {city: factionId}, detectedOffset, dictSize }.
function resolveCurrentOwners(buf, initialOwnerByCity) {
  if (!initialOwnerByCity || Object.keys(initialOwnerByCity).length === 0) {
    return { ownerByCity: {}, error: "no initial ownership provided" };
  }
  const setts = findAllSettlementMarkers(buf);
  const det = detectOwnerOffset(buf, setts, initialOwnerByCity);
  if (det.d === null) {
    return { ownerByCity: {}, error: "could not detect owner offset" };
  }
  const dict = buildUuidToFaction(buf, setts, det.d, initialOwnerByCity);
  const ownerByCity = {};
  const unknown = {};
  for (const s of setts) {
    const o = s.offset + det.d;
    if (o < 0 || o + 4 > buf.length) continue;
    const uuid = buf.readUInt32LE(o);
    if (uuid === 0 || uuid === 0xffffffff) continue;
    const fac = dict.get(uuid);
    if (fac) ownerByCity[s.name] = fac;
    else unknown[s.name] = uuid.toString(16).padStart(8, "0");
  }
  return {
    ownerByCity,
    detectedOffset: det.d,
    dictSize: dict.size,
    unknownCount: Object.keys(unknown).length,
    sampleUnknown: Object.entries(unknown).slice(0, 5),
  };
}

module.exports = {
  detectOwnerOffset,
  buildUuidToFaction,
  resolveCurrentOwners,
};
