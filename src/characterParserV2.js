// src/characterParserV2.js
//
// v2 character record parser for RTW: Alexander saves.
//
// Confirmed layout (scripted leader characters):
//   +0-3:    uint32 firstName_index (into descr_names_lookup.txt)
//   +22-25:  int32 birth_year (signed, negative for BC)
//   +298-299: uint16 trait_count
//   +304+:   trait list, 8-byte entries:
//              uint32 id
//              uint16 level
//              uint16 points_to_next_level
//   after trait list:
//     6 bytes  (includes uint16 at +2, possibly prestige for leaders)
//     uint16 length + ASCII + null  : portrait card path
//     uint16 length + ASCII + null  : portrait full path
//     4 bytes sentinel (0xffffffff)
//     uint16 length + ASCII + null  : culture/faction string ("alexander", "greek", "barbarian")
//     more data (ancillaries, family references — NOT YET PARSED)
//
// Age is derived from birth year; caller must supply current_year.
//
// To use: load the mod's name-lookup and trait-names tables, then call
// findScriptedCharacters(buf, nameLookup, traitNames).

"use strict";

// Record layout (offsets relative to RECORD START = the 0x03 type marker
// 8 bytes before firstName):
//   +0-3:    uint32 type marker (always 3 for "named character")
//   +4-7:    zeros
//   +8-11:   firstName uint32 index
//   +12-15:  family/dynasty ptr (0 for family-less, non-zero for Darius/etc)
//   +16..?:  variable-length 0xff padding. Contains (optionally) a
//            preceding 4-byte field for characters with scripted children.
//   [birth]: int32 birth year (signed). Located either at +30 (simple
//            records like Alex) or +34 (family-head records like Darius)
//            — measured from record-start.
//   birth+276:  uint16 trait count
//   birth+282:  trait list — 8 bytes per entry: uint32 id, uint16 level,
//                 uint16 points_to_next_level
//
// The trait-count-to-birth-year gap is CONSTANT at 276 bytes. So once we
// find the birth year we can derive everything else.
function parseAt(buf, off, nameLookup, traitNames) {
  if (off + 330 > buf.length) return null;

  // Validate record header
  if (buf.readUInt32LE(off) !== 3) return null;
  if (buf.readUInt32LE(off + 4) !== 0) return null;

  const firstIdx = buf.readUInt32LE(off + 8);
  if (firstIdx < 50 || firstIdx >= nameLookup.length) return null;
  const firstName = nameLookup[firstIdx];
  if (!firstName || firstName.length < 3) return null;
  if (!/^[A-Z]/.test(firstName)) return null;

  // Byte at +12 is a "has lastName" flag (0 = no surname, 1 = surname
  // present). Verified on Alexander/Parmenion (leaders, +12 = 0x00, no
  // lastName) vs Adymos/Thuxra/Darius (+12 = 0x01, lastName follows).
  // Previously the parser unconditionally read +13 as a uint32 and treated
  // any in-range value as a lastName — producing bogus surnames like
  // "Alexander Priska" when the bytes at +13 happened to point to a real
  // nameLookup entry.
  let lastIdx = 0, lastName = null;
  const hasLast = buf[off + 12] === 1;
  if (hasLast && off + 17 <= buf.length) {
    lastIdx = buf.readUInt32LE(off + 13);
    if (lastIdx >= 50 && lastIdx < nameLookup.length) {
      const n = nameLookup[lastIdx];
      if (n && /^[a-zA-Z_]/.test(n) && n.length > 2) lastName = n;
    }
  }

  // Locate birth year: scan candidate offsets +24..+40 for a signed int32
  // in the Alex-campaign range.
  let birthYearOffset = -1;
  let birthYear = 0;
  for (const candidate of [30, 34, 26, 38, 22]) {
    if (off + candidate + 4 > buf.length) continue;
    const v = buf.readInt32LE(off + candidate);
    if (v >= -500 && v <= -200) { birthYearOffset = candidate; birthYear = v; break; }
  }
  if (birthYearOffset < 0) return null;

  const traitCountOffset = birthYearOffset + 276;
  if (off + traitCountOffset + 2 > buf.length) return null;
  const traitCount = buf.readUInt16LE(off + traitCountOffset);
  // Females can have 0 traits (the engine only assigns traits to males).
  // Only upper-bound this as a sanity check.
  if (traitCount > 80) return null;

  // Trait list (starts 6 bytes after trait count)
  const traits = [];
  const listStart = off + traitCountOffset + 6;
  const listEnd = listStart + traitCount * 8;
  if (listEnd > buf.length) return null;
  let validNamedTraits = 0;
  let brokenEntries = 0;
  for (let i = 0; i < traitCount; i++) {
    const entryOff = listStart + i * 8;
    const id = buf.readUInt32LE(entryOff);
    const level = buf.readUInt16LE(entryOff + 4);
    const ptsToNext = buf.readUInt16LE(entryOff + 6);
    // Some mid-campaign records have a slightly different in-list layout for
    // later entries (observed on Thuxra, Darayavahu — records with a lastName
    // field present). Rather than reject the whole record on one bad entry,
    // skip the malformed trait and keep going. Validation below still
    // enforces majority-valid before we accept the record.
    const idOk = id >= 0 && id < traitNames.length;
    const levelOk = level <= 20;
    if (!idOk || !levelOk) { brokenEntries++; continue; }
    const name = traitNames[id];
    if (name) validNamedTraits++;
    traits.push({
      id,
      name: name || `trait_${id}`,
      level,
      pointsToNextLevel: ptsToNext,
    });
  }
  // For characters WITH traits, require MAJORITY of claimed entries to
  // resolve to real trait names (filters out random byte patterns that
  // happened to pass the header check). Females have no traits — skip
  // this check for them (traitCount=0).
  if (traitCount > 0 && validNamedTraits < Math.ceil(traitCount / 2)) return null;

  // Post-trait metadata — 6 bytes, extract possible prestige (uint16 at +2)
  const postTraitOff = listEnd;
  const postTraitBytes = buf.slice(postTraitOff, Math.min(postTraitOff + 6, buf.length));
  const possiblePrestige = postTraitOff + 4 <= buf.length ? buf.readUInt16LE(postTraitOff + 2) : 0;

  // Portrait card path
  let p = postTraitOff + 6;
  const portraits = [];
  let culture = null;
  for (let stringIdx = 0; stringIdx < 4 && p + 2 < buf.length; stringIdx++) {
    const len = buf.readUInt16LE(p);
    if (len < 3 || len > 200) break;
    const stringEnd = p + 2 + len;
    if (stringEnd > buf.length) break;
    let ok = true, s = "";
    for (let k = 0; k < len - 1; k++) {
      const b = buf[p + 2 + k];
      if (b < 0x20 || b > 0x7e) { ok = false; break; }
      s += String.fromCharCode(b);
    }
    if (!ok) break;
    if (buf[stringEnd - 1] !== 0) break;
    if (s.includes("/") || s.includes(".tga")) {
      portraits.push(s);
    } else if (!culture && /^[a-z_]+$/.test(s)) {
      culture = s;
    }
    p = stringEnd;
    // After the two portraits, skip 4 bytes of sentinel 0xffffffff
    if (portraits.length === 2 && p + 4 <= buf.length &&
        buf.readUInt32LE(p) === 0xffffffff) {
      p += 4;
    }
  }

  // Gender heuristic: RTW assigns traits only to male characters. Females
  // (wives, daughters) have 0 traits. Young male children may also have 0
  // temporarily, but in a mid/late campaign characters with no traits are
  // overwhelmingly female.
  const gender = traitCount > 0 ? "male" : "female";

  // Pre-record header (12 bytes before the 0x03 record start):
  //   [-12..-9] : primary_uuid (character identity)
  //   [ -8..-5] : commander_uuid (matches unit.commanderUuid)
  // Verified on Alexander, Parmenion, Darius, Memnon.
  let primaryUuid = 0, commanderUuid = 0;
  if (off >= 12) {
    primaryUuid = buf.readUInt32LE(off - 12);
    commanderUuid = buf.readUInt32LE(off - 8);
  }

  return {
    offset: off,
    firstName,
    firstIdx,
    lastName,
    lastIdx,
    birthYear,
    gender,
    traitCount,
    traits,
    rawPostTrait: postTraitBytes.toString("hex"),
    possiblePrestige,
    portraits,
    culture,
    primaryUuid,
    commanderUuid,
  };
}

// Find all `captain_card_<faction>.tga` string markers in the save. Each
// faction's character block is preceded by one of these strings. We map
// file positions to faction IDs so each character can be assigned to a
// faction based on the last such marker before their offset.
function findFactionMarkers(buf) {
  const markers = [];
  const pattern = Buffer.from("captain_card_", "ascii");
  let p = 0;
  while ((p = buf.indexOf(pattern, p)) !== -1) {
    // Read the faction name (ASCII until ".tga")
    let end = p + pattern.length;
    let factionName = "";
    while (end < buf.length) {
      const b = buf[end];
      if (b === 0x2e /* . */) break; // stop at "."
      if (b < 0x20 || b > 0x7e) break;
      factionName += String.fromCharCode(b);
      end++;
    }
    if (factionName.length > 0 && factionName.length < 30) {
      markers.push({ pos: p, faction: factionName });
    }
    p += pattern.length;
  }
  return markers;
}

function assignFactions(records, factionMarkers) {
  factionMarkers.sort((a, b) => a.pos - b.pos);
  for (const r of records) {
    let lastFaction = null;
    for (const m of factionMarkers) {
      if (m.pos < r.offset) lastFaction = m.faction;
      else break;
    }
    r.faction = lastFaction;
  }
}

// Find all scripted characters by scanning for the type=3 record header.
// Each record starts with uint32(3) + uint32(0) — a distinctive 8-byte
// pattern that only appears at real character record boundaries (a quick
// structural filter before attempting the full parse).
function findScriptedCharacters(buf, nameLookup, traitNames) {
  const found = [];
  const signature = Buffer.from([3, 0, 0, 0, 0, 0, 0, 0]);
  let p = 0;
  while (p < buf.length - 320) {
    p = buf.indexOf(signature, p);
    if (p === -1) break;
    const rec = parseAt(buf, p, nameLookup, traitNames);
    if (rec) {
      found.push(rec);
      // Each record is at least 320 bytes; skip ahead conservatively.
      p += 300;
    } else {
      p += 1;
    }
  }
  // After basic records are parsed, attach position data by scanning
  // each record's region for a uint32 matching a type-6 world-object UUID.
  attachPositions(buf, found);
  // Attach faction based on preceding `captain_card_<faction>.tga` marker.
  const markers = findFactionMarkers(buf);
  assignFactions(found, markers);
  return found;
}

// Scan world-object records to build uuid → (x, y) map. Three record types
// each carry one army's live (x, y), keyed by the army's commander uuid:
//   - type=6: general's bodyguard / named character army position
//   - type=5: captain-led land army position (no named general)
//   - type=4: naval army position (admiral's fleet)
// Verified on turn-1 alexander save:
//   - Adymos.commanderUuid = 0x16646665 → type-5 @ (10,50) ✓
//   - Assandros.commanderUuid = 0xa845b795 → type-4 @ (17,46) ✓
// All three record types share the same on-disk shape:
//   [type uint32][zero pad][uuid uint32][self-offset uint32][x uint32][y uint32].
function collectWorldObjectPositions(buf) {
  const m = new Map();
  for (let N = 24; N < buf.length - 8; N++) {
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const type = buf.readUInt32LE(N - 12);
    if (type !== 6 && type !== 5 && type !== 4) continue;
    const x = buf.readUInt32LE(N);
    if (x < 0 || x > 200) continue;
    const y = buf.readUInt32LE(N + 4);
    if (y < 0 || y > 150) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0) continue;
    // type-6 wins on collision (named-general bodyguard is more authoritative
    // than the army-record entry for the same uuid).
    if (type === 6 || !m.has(uuid)) m.set(uuid, { x, y });
  }
  return m;
}

// Attach (x, y) to each character.
//
// Primary method: the character's commanderUuid (at record_start - 8) IS
// the uuid of their army's type-6 position record. Verified on Parmenion
// at Turn 13: his commanderUuid = 0xf3fb6884 = type-6 record at (17, 44)
// which matches his log-known position.
//
// Fallback: if commanderUuid doesn't resolve to a known type-6 position
// (e.g. the character's bodyguard unit is placed inside a settlement and
// the settlement-record has the same uuid), scan the character's record
// region for any matching type-6 uuid. Last resort.
function attachPositions(buf, records) {
  const positions = collectWorldObjectPositions(buf);
  records.sort((a, b) => a.offset - b.offset);
  // Every other character's primary/commander uuid — we must NOT use these
  // as a fallback position source, or characters without their own army
  // will be misattributed to their neighbors in the save's character block.
  // (Concrete failure before this filter: Adymos, whose own commanderUuid
  // didn't resolve to a type-6 record, would scan forward into Alexander's
  // pre-header bytes and grab Alexander's commanderUuid — placing Adymos at
  // Alexander's tile (11,49) instead of his descr_strat position (10,50).)
  const reservedUuids = new Set();
  for (const r of records) {
    if (r.primaryUuid) reservedUuids.add(r.primaryUuid);
    if (r.commanderUuid) reservedUuids.add(r.commanderUuid);
  }
  for (let i = 0; i < records.length; i++) {
    const r = records[i];

    // Step 1: commanderUuid (at record_start - 8) — the real army position
    if (r.commanderUuid) {
      const pos = positions.get(r.commanderUuid);
      if (pos) {
        r.worldObjectUuid = r.commanderUuid;
        r.x = pos.x;
        r.y = pos.y;
        continue;
      }
    }

    // Step 2: scan the record region for any type-6 uuid. Stop 12 bytes
    // before the next character's 0x03 signature so we don't read into
    // their pre-header primary/commander uuids. Also skip any uuid that
    // belongs to another character (reservedUuids) — those are never the
    // current character's army position, and finding them means we've
    // walked too far. This fallback exists for characters whose own
    // commander_uuid doesn't resolve to a type-6 record (family members,
    // characters stacked inside a settlement) — in those cases we're
    // willing to attach whatever army position happens to be nearby, but
    // only if it's not some other character's identity.
    const nextOff = i + 1 < records.length ? records[i + 1].offset : buf.length;
    const end = Math.min(nextOff - 12, r.offset + 2500);
    for (let p = r.offset; p + 4 <= end; p++) {
      const v = buf.readUInt32LE(p);
      if (reservedUuids.has(v)) continue;
      const pos = positions.get(v);
      if (pos) {
        r.worldObjectUuid = v;
        r.x = pos.x;
        r.y = pos.y;
        break;
      }
    }
  }
}

// Given a birth year and the current in-game year, derive age.
function computeAge(birthYear, currentYear) {
  if (!birthYear || !currentYear) return null;
  return currentYear - birthYear;
}

module.exports = {
  parseAt,
  findScriptedCharacters,
  computeAge,
};
