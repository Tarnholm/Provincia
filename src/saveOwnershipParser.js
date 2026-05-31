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

// Some settlement markers are stored by their REGION name rather than their
// SETTLEMENT name (cracked 2026-05-31 — e.g. on the RoR Turn-8 save the player
// capital's marker reads "Roma" not "Rome", and "Etruria"/"Rhegion" instead of
// "Arretium"/"Rhegium"). Those names aren't in initialOwnerByCity (which is
// keyed by settlement name), so the marker contributed nothing to the UUID→
// faction vote AND never resolved — orphaning the settlement + every unit whose
// region maps to it. `normalizeName` maps a region-name marker to its
// settlement name via descr_regions so it behaves like a normal settlement.
// (regionToSettlement may be null — then this is a no-op and behaviour is
// identical to the pre-2026-05-31 code.)
function makeNormalizer(initialOwnerByCity, regionToSettlement) {
  if (!regionToSettlement) return (name) => name;
  return (name) => {
    if (name in initialOwnerByCity) return name;          // already a settlement name
    const s = regionToSettlement[name];                    // region name → settlement
    return (s && s in initialOwnerByCity) ? s : name;
  };
}

// Scan candidate offsets and pick the one where settlements with same
// descr_strat faction share the same uint32 value.
// Returns { bestOffset, score } where score = # of settlements cleanly mapped.
function detectOwnerOffset(buf, setts, initialOwnerByCity, normalize = (n) => n) {
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
      const fac = initialOwnerByCity[normalize(s.name)];
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
      const fac = initialOwnerByCity[normalize(s.name)];
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

// Build UUID → faction dictionary using descr_strat plurality vote at the
// given offset. Returns Map<uuid_u32, factionId_string>.
//
// Key insight: each UUID is unique to ONE faction. When that faction
// conquers settlements from others, those settlements adopt the
// conqueror's UUID. So a UUID's set of settlements always includes some
// of the conqueror's ORIGINAL (descr_strat-anchored) settlements PLUS
// however many they've conquered. The plurality faction in the descr_strat
// distribution is therefore the conqueror.
//
// Earlier code required 60%+ majority — too strict for mid/late game.
// At turn 22, factions like Athens commonly hold 4 starting + 3 conquered
// from multiple enemies = 4/7=57% majority, which the old rule rejected.
// That orphaned ~30% of settlements (the user's missing conquests).
//
// New rule: trust the top faction if it has the strict plurality AND has
// at least one descr_strat-anchored settlement under this UUID. Ties go
// to whichever faction has a clearer starting-cluster signature (broken by
// the alphabet as a last resort).
function buildUuidToFaction(buf, setts, offset, initialOwnerByCity, normalize = (n) => n) {
  const uuidToFac = new Map();
  for (const s of setts) {
    const fac = initialOwnerByCity[normalize(s.name)];
    if (!fac) continue;
    const o = s.offset + offset;
    if (o < 0 || o + 4 > buf.length) continue;
    const v = buf.readUInt32LE(o);
    if (v === 0 || v === 0xffffffff) continue;
    if (!uuidToFac.has(v)) uuidToFac.set(v, new Map());
    const fm = uuidToFac.get(v);
    fm.set(fac, (fm.get(fac) || 0) + 1);
  }
  const dict = new Map();
  for (const [uuid, fmap] of uuidToFac) {
    if (fmap.size === 0) continue;
    // Sort by vote DESC, then alphabet ASC for stable tie-break.
    const entries = [...fmap.entries()].sort((a, b) =>
      b[1] - a[1] || a[0].localeCompare(b[0])
    );
    const [topFac] = entries[0];
    dict.set(uuid, topFac);
  }
  return dict;
}

// For each settlement, read its current owner UUID and resolve to faction.
// Returns { ownerByCity: {city: factionId}, detectedOffset, dictSize }.
function resolveCurrentOwners(buf, initialOwnerByCity, regionToSettlement = null) {
  if (!initialOwnerByCity || Object.keys(initialOwnerByCity).length === 0) {
    return { ownerByCity: {}, error: "no initial ownership provided" };
  }
  const normalize = makeNormalizer(initialOwnerByCity, regionToSettlement);
  const setts = findAllSettlementMarkers(buf);
  const det = detectOwnerOffset(buf, setts, initialOwnerByCity, normalize);
  if (det.d === null) {
    return { ownerByCity: {}, error: "could not detect owner offset" };
  }
  const dict = buildUuidToFaction(buf, setts, det.d, initialOwnerByCity, normalize);
  // Identify the "slave/rebel" faction id from descr_strat — every RTW
  // campaign carries one. Settlements with uuid=0 (the rebel sentinel)
  // resolve to this faction. Without this, ~10 rebel-occupied settlements
  // per save stayed unresolved and showed as "unknown" on the map.
  const slaveFaction = (() => {
    const counts = new Map();
    for (const f of Object.values(initialOwnerByCity)) counts.set(f, (counts.get(f) || 0) + 1);
    for (const candidate of ["slave", "rebels", "slaves"]) {
      if (counts.has(candidate)) return candidate;
    }
    // Fall back to the most common faction (almost always the rebel default).
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  })();
  const ownerByCity = {};
  const unknown = {};
  // Track which keys were resolved to a real (dict-backed) faction so a later
  // duplicate marker for the SAME settlement (e.g. a region-name marker whose
  // UUID isn't in the dict) can't clobber a good resolution with a worse one.
  const resolvedReal = new Set();
  for (const s of setts) {
    const o = s.offset + det.d;
    if (o < 0 || o + 4 > buf.length) continue;
    const uuid = buf.readUInt32LE(o);
    if (uuid === 0xffffffff) continue;
    // Map region-name markers (e.g. "Roma") to their settlement name ("Rome")
    // so they resolve and key correctly; settlement-name markers pass through.
    const key = normalize(s.name);
    if (uuid === 0) {
      // Slave/rebel sentinel — only fill if nothing real already claimed it.
      if (slaveFaction && !resolvedReal.has(key)) ownerByCity[key] = slaveFaction;
      continue;
    }
    const fac = dict.get(uuid);
    if (fac) { ownerByCity[key] = fac; resolvedReal.add(key); delete unknown[key]; }
    else if (!resolvedReal.has(key) && !(key in ownerByCity)) {
      unknown[key] = uuid.toString(16).padStart(8, "0");
    }
  }
  return {
    ownerByCity,
    detectedOffset: det.d,
    dictSize: dict.size,
    unknownCount: Object.keys(unknown).length,
    sampleUnknown: Object.entries(unknown).slice(0, 5),
  };
}

// Read the per-settlement governor reference field. Located at
// `marker.offset - 1940` (RIS imperial), 4 bytes after the owner UUID
// at -1944. CONFIRMED 2026-05-10 by matching against v1 character
// secondaryUuids on a turn-5 RoR save: Rome → Quintus Ogulnius_Gallus
// (player leader, garrisoned in capital), Uria → Aulus Gabinius (the
// player's installed governor after conquering Salentinia from rebels).
//
// Returns { settlement_name: governor_secondary_uuid } for every
// settlement that has a non-zero governor. The caller cross-references
// the uuid against findCharacterRecords()'s output to get the name.
//
// Caveat: only ~19 of 1310 settlements had matchable v1 chars on the
// RoR T5 save. The other settlements either:
//   1. Have no governor (lots of small AI cities don't),
//   2. Have an AI faction's character we don't decode (RIS-imperial
//      auto-generated chars are in a v1-incompatible format), or
//   3. The uuid here points to a captain not represented as a v1 record.
function findSettlementGovernors(buf, settlements, governorOffset = -1940) {
  const out = {};
  for (const s of settlements) {
    const o = s.offset + governorOffset;
    if (o < 0 || o + 4 > buf.length) continue;
    const v = buf.readUInt32LE(o);
    if (v === 0 || v === 0xffffffff) continue;
    out[s.name] = v;
  }
  return out;
}

module.exports = {
  detectOwnerOffset,
  buildUuidToFaction,
  resolveCurrentOwners,
  findSettlementGovernors,
};
