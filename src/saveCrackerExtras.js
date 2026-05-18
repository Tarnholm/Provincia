// src/saveCrackerExtras.js
//
// Consolidates all newly-cracked save-file fields (2026-05-17 / 2026-05-18) so
// Provincia can use them in any future UI feature.
//
// Coverage:
//   * Header (campaign UUID, mod display name, mod content hash, faction-discovered
//     bitmask, faction-config 53-byte records)
//   * Per-character extras (own_uuid, role, region, spouse_uuid, age) anchored on
//     `<culture> <role>` ASCII pstr16
//   * Per-settlement extras (already in main.js — re-exported here for completeness)
//   * Per-soldier weapon byte (9-byte soldier records, byte +0 = weapon_lvl × 4)
//   * Unit-level stat aggregate slots (3× 14-byte blocks of pattern
//     `01 00 40 00 XX ...` — weapon/armor/experience aggregates)
//
// Each function is pure-read: no side effects, returns plain JS objects.
//
// Validated against:
//   - Spain T1 (vanilla imperial)
//   - Macedon T0 (RIS imperial, 109 characters)
//   - Arretium PRE/QUEUE/POST/T2-queued/T3/T4 (RIS imperial)
//   - Alex Macedon T1/T11/T12 (alexander campaign)

"use strict";

// ── Header ──────────────────────────────────────────────────────────────────

function readCampaignName(buf) {
  if (buf.length < 0x60) return "";
  const len = buf.readUInt16LE(0x3a);
  if (len < 1 || len > 64 || 0x3c + len * 2 > buf.length) return "";
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(0x3c + i * 2);
    if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
  }
  return s;
}

// Read header essentials. Cheap; safe to call once per save load.
function parseHeader(buf) {
  if (buf.length < 0x100) return null;
  const magic = buf.readUInt32LE(0x00);
  if (magic !== 0x070a) return null;
  const campaignUuid = buf.readUInt32LE(0x04);
  const campaignTypeFlag = buf.readUInt32LE(0x1c);
  const saveVersion = buf.readUInt32LE(0x20);
  // 12-byte content hash (3 u32 sub-hashes — campaign / mod / setup variant)
  const hash = [
    buf.readUInt32LE(0x24),
    buf.readUInt32LE(0x28),
    buf.readUInt32LE(0x2c),
  ];
  const sessionTimestamp = buf.readUInt32LE(0x30);
  const campaignName = readCampaignName(buf);
  return {
    magic,
    campaignUuid,
    campaignTypeFlag,           // 0x20004 imperial / 0x20204 alexander
    saveVersion,                // 7 for RR
    hash,                       // 3 × u32
    sessionTimestamp,
    campaignName,
    nameEnd: 0x3c + campaignName.length * 2,
  };
}

// Read the per-faction "discovered by player" bitmask. Layout:
//   name_end+16..18: 3 constant bytes `9c c7 06`
//   name_end+19    : u8 bitmask byte count
//   name_end+20..  : bitmask bytes
function parseFactionDiscoveredBitmask(buf, hdr) {
  if (!hdr) return null;
  const start = hdr.nameEnd + 16;
  if (start + 4 > buf.length) return null;
  if (buf[start] !== 0x9c || buf[start + 1] !== 0xc7 || buf[start + 2] !== 0x06) return null;
  const count = buf[start + 3];
  if (count < 1 || count > 100) return null;
  const bits = [];
  for (let i = 0; i < count; i++) {
    const b = buf[start + 4 + i];
    for (let k = 0; k < 8; k++) bits.push((b >> k) & 1);
  }
  const discoveredCount = bits.filter(b => b).length;
  return { byteCount: count, totalFactions: count * 8, bits, discoveredCount };
}

// Read faction-config 53-byte records. Each record byte +29 = faction roster index
// (or 21 = slave-merged / disabled). Each record byte +4 = total faction count
// (redundant — matches header's faction count).
//
// First record marker `12 34 de 0a` is at name_end + 146 (RIS-imperial 240-bit
// bitmask) or name_end + 92 (vanilla 24-bit bitmask). Position depends on
// bitmask size.
function parseFactionConfigRecords(buf, hdr, bitmask) {
  if (!hdr || !bitmask) return null;
  const MARKER = Buffer.from([0x12, 0x34, 0xde, 0x0a]);
  // Scan a small range starting from after the bitmask + small trailer
  const searchStart = hdr.nameEnd + 20 + bitmask.byteCount;
  const firstMarker = buf.indexOf(MARKER, searchStart);
  if (firstMarker < 0 || firstMarker - searchStart > 200) return null;
  const factionCount = buf.readUInt32LE(firstMarker + 4);
  if (factionCount < 1 || factionCount > 300) return null;
  // Verify the next few markers are at +53 each
  const recordSize = 53;
  for (let i = 0; i < Math.min(5, factionCount); i++) {
    const ofs = firstMarker + i * recordSize;
    if (buf[ofs] !== 0x12 || buf[ofs + 1] !== 0x34 || buf[ofs + 2] !== 0xde || buf[ofs + 3] !== 0x0a) {
      return null;
    }
  }
  const records = [];
  for (let i = 0; i < factionCount; i++) {
    const ofs = firstMarker + i * recordSize;
    if (ofs + recordSize > buf.length) break;
    records.push({
      index: i,
      offset: ofs,
      factionIndex: buf[ofs + 29],     // descr_strat order, or 21 = slave-merged
      flag43: buf[ofs + 43],
      flag47: buf[ofs + 47],
      flag48: buf[ofs + 48],
    });
  }
  return { firstMarker, recordSize, factionCount, records };
}

// Try to read the mod display name (UTF-16 LE) located at ~0x326d.
// Returns null if save was made without an explicit mod path.
function parseModInfo(buf) {
  if (buf.length < 0x4500) return null;
  function readPstr16Utf16At(off) {
    if (off + 2 > buf.length) return null;
    const chars = buf.readUInt16LE(off);
    if (chars < 4 || chars > 200) return null;
    if (off + 2 + chars * 2 > buf.length) return null;
    let s = "";
    for (let i = 0; i < chars; i++) {
      const c = buf[off + 2 + i * 2];
      const h = buf[off + 2 + i * 2 + 1];
      if (h !== 0 || c < 0x20 || c > 0x7e) return null;
      s += String.fromCharCode(c);
    }
    return { str: s, totalLen: 2 + chars * 2 };
  }
  const modDisplayName = readPstr16Utf16At(0x326d);
  const modContentHash = readPstr16Utf16At(0x32c2);
  const modPath = readPstr16Utf16At(0x43fc);
  const actionCounter = buf.length >= 0x4400 ? buf.readUInt32LE(0x43f8) : 0;
  return {
    modDisplayName: modDisplayName ? modDisplayName.str : null,
    modContentHash: modContentHash ? modContentHash.str : null,
    modPath: modPath ? modPath.str : null,
    actionCounter,
  };
}

// ── Per-character extras (anchored on role string) ──────────────────────────

const CULTURES = ["roman", "greek", "barbarian", "eastern", "egyptian", "carthaginian"];
const ROLES = ["general", "captain", "diplomat", "spy", "assassin", "admiral", "merchant"];

// Find every <culture> <role>\0 ASCII pstr16 in the buffer and extract the
// per-character fields anchored on it. The character record has:
//   role+15  u32  own UUID
//   role+19  u32  bodyguard / commander UUID
//   role+35  u16  region name char count (L)
//   role+37  UTF-16 region name (2L bytes)
//   role+37+2L     u32 ff ff ff ff sentinel
//   role+37+2L+4   u32 spouse UUID  (0 / 0xffffffff = unmarried)
//   role+37+2L+8   f32 (unknown semantics)
//   role+37+2L+12  u32 age in years
//   role+37+2L+16  u32 second age value (possibly fine-grained sub-counter)
function parseCharacterExtras(buf) {
  const out = [];
  for (const culture of CULTURES) {
    for (const role of ROLES) {
      const target = Buffer.from(culture + " " + role + "\0", "ascii");
      let p = 0;
      while (true) {
        const idx = buf.indexOf(target, p);
        if (idx === -1) break;
        p = idx + 1;
        if (idx + 80 > buf.length) continue;
        const ownUuid = buf.readUInt32LE(idx + 15);
        if (ownUuid === 0 || ownUuid === 0xffffffff) continue;
        const bodyguardUuid = buf.readUInt32LE(idx + 19);
        const regionLen = buf.readUInt16LE(idx + 35);
        if (regionLen < 1 || regionLen > 32) continue;
        // Read region name (UTF-16 LE)
        let region = "";
        let regionValid = true;
        for (let i = 0; i < regionLen; i++) {
          const lo = buf[idx + 37 + i * 2];
          const hi = buf[idx + 37 + i * 2 + 1];
          if (hi !== 0 || lo < 0x20 || lo > 0x7e) { regionValid = false; break; }
          region += String.fromCharCode(lo);
        }
        if (!regionValid) continue;
        const postRegion = idx + 37 + regionLen * 2;
        // Validate sentinel
        if (buf.readUInt32LE(postRegion) !== 0xffffffff) continue;
        const spouseUuid = buf.readUInt32LE(postRegion + 4);
        const age = buf.readUInt32LE(postRegion + 12);
        if (age > 200) continue; // sanity
        out.push({
          offset: idx,
          role,
          culture,
          ownUuid,
          bodyguardUuid,
          region,
          spouseUuid,
          isMarried: spouseUuid !== 0 && spouseUuid !== 0xffffffff,
          age,
        });
      }
    }
  }
  return out;
}

// Parse all "major faction" records — one per playable faction. Each record
// holds the faction's current treasury, start-of-turn treasury (so net
// = income earned this turn so far), regionCount, and region IDs.
//
// Confirmed structure from session 5 (cracker memory `dig-faction-treasury-final.js`):
//   +0   i32  current treasury (denarii)
//   +8   u32 = 100   (MAJOR-CLASS tag — distinguishes from rebels/NPCs)
//   +12  u32 = 1     (version)
//   +24  self_ptr   = record_pos + 24
//   +40  self_ptr   = record_pos + 40
//   +44  u32 = 6     (next sub-section size)
//   +48  u32         regionCount
//   +52..+(52+4N)    region IDs (u32 each)
//   +(92 + 4N)       i32 start-of-turn treasury snapshot
//
// Validates on Macedon T0 (vanilla imperial, 34 MB save): 23 records found,
// player at index 0, treasuries in 5000–20000 range. Spain T1 classic save
// doesn't have these records — classic campaign uses a different format.
function parseFactionTreasuries(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    if (i + 92 + 4 * regions + 4 > buf.length) continue;
    const treasury = buf.readInt32LE(i);
    const turnStart = buf.readInt32LE(i + 92 + 4 * regions);
    const regionIds = [];
    for (let r = 0; r < regions; r += 1) regionIds.push(buf.readUInt32LE(i + 52 + r * 4));
    out.push({
      offset: i,
      treasury,
      turnStartTreasury: turnStart,
      // `net` = income earned so far this turn (treasury - turnStart). For
      // a turn-start save (T1, T2 etc.) net is typically 0; mid-turn saves
      // show partial income.
      netThisTurn: treasury - turnStart,
      regionCount: regions,
      regionIds,
    });
  }
  return out;
}

// Extract per-faction diplomatic relations. Each major faction record has
// a `05 00 24 39` marker at offset +(244 + 4 × regionCount), followed by
// `u32 count` and `count × 16-byte` entries. Each entry:
//   +0   u32 relationUuid   (globally unique counter — same UUID never
//                            appears in two different factions' lists)
//   +4   u32 class          (0 = ALLIED, 1 = ceasefire, 2 = WAR,
//                            4 = locked alliance — per session 108 memory)
//   +8   u32 attitudeTier   (0..4)
//   +12  u32 tag            (constant 0x00010101)
//
// LIMITATION: the entry does NOT contain the OTHER faction's identity.
// Memory session 108/109: the (factionA, factionB) → relation mapping
// requires an external lookup that hasn't been cracked yet.
function parseFactionDiplomacy(buf, factionRecords) {
  const DIPLO_MARKER = 0x39240005; // little-endian "05 00 24 39"
  const out = [];
  for (let i = 0; i < factionRecords.length; i += 1) {
    const r = factionRecords[i];
    const expectedOff = r.offset + 244 + 4 * r.regionCount;
    if (expectedOff + 8 > buf.length) { out.push({ relations: [] }); continue; }
    if (buf.readUInt32LE(expectedOff) !== DIPLO_MARKER) { out.push({ relations: [] }); continue; }
    const count = buf.readUInt32LE(expectedOff + 4);
    if (count > 200) { out.push({ relations: [] }); continue; }
    const relations = [];
    for (let k = 0; k < count; k += 1) {
      const o = expectedOff + 8 + k * 16;
      if (o + 16 > buf.length) break;
      relations.push({
        uuid: buf.readUInt32LE(o),
        class_: buf.readUInt32LE(o + 4),
        attitude: buf.readUInt32LE(o + 8),
        tag: buf.readUInt32LE(o + 12),
      });
    }
    out.push({ relations, markerOffset: expectedOff });
  }
  return out;
}

// Walk all region records in the save. Signature found 2026-05-18:
// region records have paired self-pointers 8 bytes apart, with a region
// UUID between them and the engine's numeric region ID at +12.
//
//   +0   u32  self_ptr_A == record_offset
//   +4   u32  region_uuid
//   +8   u32  self_ptr_B == record_offset + 8
//   +12  u32  region_id     (matches parseFactionTreasuries.regionIds)
//   +16  ...  per-region data
//
// Returns an array of `{offset, regionUuid, regionId}` per region record.
function findRegionRecords(buf) {
  const out = [];
  for (let off = 0x3000; off + 16 < buf.length; off += 4) {
    if (buf.readUInt32LE(off) !== off) continue;
    if (buf.readUInt32LE(off + 8) !== off + 8) continue;
    out.push({
      offset: off,
      regionUuid: buf.readUInt32LE(off + 4),
      regionId: buf.readUInt32LE(off + 12),
    });
  }
  return out;
}

// Read the +288 / +292 map coordinates from each character's extended
// record. Useful for bridging save data ↔ descr_strat data (descr_strat
// character lines have explicit x,y; the extended record stores the same
// values). Resolves 134/143 chars on Macedon T0 vanilla save.
function attachMapCoords(buf, characters) {
  for (const c of characters) {
    if (!c.ownUuid) continue;
    const ownBytes = Buffer.alloc(4);
    ownBytes.writeUInt32LE(c.ownUuid);
    const ref = buf.indexOf(ownBytes, 0x1500000);
    if (ref < 0 || ref >= c.offset) continue;
    if (ref + 296 > buf.length) continue;
    c.extX = buf.readUInt32LE(ref + 288);
    c.extY = buf.readUInt32LE(ref + 292);
  }
}

// Crack 2026-05-18: each character's portrait is identified by a u32
// portrait UUID stored at offset +280 of the character's 354-byte extended
// record (located by the first back-ref of own_uuid in the portrait pool
// section, before the role string). The portrait pool entries embed pstr16
// portrait paths with their UUID 72–74 bytes AFTER each pstr16 start.
//
// Validated on Macedon T0 vanilla save: 103/109 greek generals resolved to
// unique portrait paths.
function resolvePortraitsByCharacter(buf, characters) {
  // Walk every pstr16 portrait path in the buffer. For each cards/portraits
  // pair, sweep a small window AFTER the pair for the u32 portrait_uuid
  // (empirically ~16–32 bytes after the portraits pstr16 ends). Index every
  // u32 in that window under the pair so a character's +280 lookup hits
  // even if the exact byte offset varies between records.
  const portraitByUuid = new Map(); // portraitUuid -> { cards, fulls, atCards }
  let lastCards = null;
  for (let i = 0x1000; i + 200 < buf.length; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 8 || len > 200) continue;
    let s = "", ok = true;
    for (let k = 0; k < len - 1; k++) {
      const b = buf[i + 2 + k];
      if (b < 0x20 || b > 0x7e) { ok = false; break; }
      s += String.fromCharCode(b);
    }
    if (!ok || buf[i + 2 + len - 1] !== 0) continue;
    if (!s.startsWith("data/ui/") || !s.includes("/portraits/")) continue;
    if (s.includes("/cards/")) {
      lastCards = { at: i, s };
    } else if (lastCards) {
      const entry = { cards: lastCards.s, fulls: s, atCards: lastCards.at };
      // Sweep the window from pair end to pair end + 64 bytes for u32
      // candidates; index each so the character's +280 lookup resolves.
      const pairEnd = i + 2 + len;
      for (let off = pairEnd; off + 4 < Math.min(buf.length, pairEnd + 64); off++) {
        const cand = buf.readUInt32LE(off);
        if (cand === 0 || cand === 0xffffffff) continue;
        if (!portraitByUuid.has(cand)) portraitByUuid.set(cand, entry);
      }
      lastCards = null;
    }
    i += 1 + len;
  }

  // For each character, locate their extended record and read +280, then
  // look up portraitByUuid. If the UUID lookup misses (some characters —
  // typically rebels / procedurally-generated — have small enumerated
  // seeds in +280 instead of a full portrait UUID), fall back to building
  // a path from the seed via `seed % pool_size`.
  const byOwnUuid = new Map();
  // Approximate pool sizes per (culture, age) — used for seed-modulo
  // fallback. Read from real listings in production if possible.
  const POOL_SIZES = {
    "greek/young": 188, "greek/old": 188,
    "roman/young": 479, "roman/old": 479,
    "eastern/young": 188, "eastern/old": 188,
    "egyptian/young": 188, "egyptian/old": 188,
    "carthaginian/young": 188, "carthaginian/old": 188,
    "barbarian/young": 188, "barbarian/old": 188,
  };
  for (const c of characters) {
    if (!c.ownUuid) continue;
    const ownBytes = Buffer.alloc(4);
    ownBytes.writeUInt32LE(c.ownUuid);
    const ref = buf.indexOf(ownBytes, 0x1500000);
    if (ref < 0 || ref >= c.offset) continue;
    if (ref + 284 > buf.length) continue;
    const portraitUuid = buf.readUInt32LE(ref + 280);
    if (portraitUuid === 0 || portraitUuid === 0xffffffff) continue;
    const portrait = portraitByUuid.get(portraitUuid);
    if (portrait) {
      byOwnUuid.set(c.ownUuid, {
        portraitUuid,
        cards: portrait.cards,
        fulls: portrait.fulls,
      });
      continue;
    }
    // Fallback: seed-modulo for chars without a stored portrait UUID
    // (rebels, procedurally-generated). Pick young if age < 35.
    const ageBucket = (c.age != null && c.age >= 35) ? "old" : "young";
    const poolKey = `${c.culture}/${ageBucket}`;
    const poolSize = POOL_SIZES[poolKey] || 188;
    const idx = portraitUuid % poolSize;
    const num = String(idx).padStart(3, "0");
    byOwnUuid.set(c.ownUuid, {
      portraitUuid,
      cards: `data/ui/${c.culture}/portraits/cards/${ageBucket}/generals/${num}.tga`,
      fulls: `data/ui/${c.culture}/portraits/portraits/${ageBucket}/generals/${num}.tga`,
      derived: true,
    });
  }
  return byOwnUuid;
}

// Build family tree maps. Provincia's existing v1 parser already produces
// father_uuid; combine with our spouse_uuid to expose parent/spouse/children.
//
// Args: characters (from parseCharacterExtras), v1Chars (from existing
// characterParser.js if available).
//
// Returns:
//   byUuid:       Map(ownUuid → character)
//   spouseOf:     Map(uuid → spouseUuid)
//   childrenOf:   Map(parentUuid → [childUuid, ...])
function buildFamilyTreeMaps(characters, v1Chars) {
  const byUuid = new Map();
  for (const c of characters) byUuid.set(c.ownUuid, c);
  const spouseOf = new Map();
  for (const c of characters) {
    if (c.isMarried) spouseOf.set(c.ownUuid, c.spouseUuid);
  }
  const childrenOf = new Map();
  if (v1Chars && Array.isArray(v1Chars)) {
    for (const c of v1Chars) {
      const father = c.fatherUuid;
      if (!father || father === 0xffffffff) continue;
      if (!childrenOf.has(father)) childrenOf.set(father, []);
      childrenOf.get(father).push(c.primaryUuid || c.ownUuid || c.uuid);
    }
  }
  return { byUuid, spouseOf, childrenOf };
}

// ── Per-soldier stats ───────────────────────────────────────────────────────

// Decode soldier records of a unit. Each soldier is 9 bytes:
//   +0  u8 weapon_lvl (encoded as level × 4; 0x04 = +1, 0x08 = +2, 0x0c = +3)
//   +1  u8 (zeros for fresh recruits — possibly secondary stat)
//   +2  u8 (zeros — possibly experience or HP)
//   +3  u8 (zeros)
//   +4  u8 (zeros — possibly hit-points-lost or status)
//   +5..+8  4 bytes soldier UUID (varies per soldier)
//
// Returns array of soldier objects + aggregate display weapon level.
function parseSoldierArray(buf, arrayStart, maxSoldiers = 240) {
  const soldiers = [];
  let weaponSum = 0;
  for (let i = 0; i < maxSoldiers; i++) {
    const off = arrayStart + i * 9;
    if (off + 9 > buf.length) break;
    const w = buf[off];
    // Stop at the first record where bytes 0..4 are all 0xff (padding/end)
    if (w === 0xff && buf[off + 1] === 0xff && buf[off + 4] === 0xff) break;
    soldiers.push({
      weaponLvl: Math.floor(w / 4),
      rawWeaponByte: w,
      uuid: buf.readUInt32LE(off + 5),
    });
    weaponSum += Math.floor(w / 4);
  }
  return {
    count: soldiers.length,
    soldiers,
    avgWeaponLvl: soldiers.length > 0 ? weaponSum / soldiers.length : 0,
  };
}

// Read the 3 unit-level stat aggregate slots that precede the soldier array.
// Each slot is 14 bytes with pattern `01 00 40 00 XX 00 00 00 00 00 00 00 00 00`
// where XX (byte +4) holds the level (× 4 encoding).
//
// Three slots in order are probably weapon / armor / experience aggregates,
// but the exact mapping isn't fully validated.
function parseUnitStatSlots(buf, slotsStart) {
  if (slotsStart + 42 > buf.length) return null;
  const slots = [];
  for (let i = 0; i < 3; i++) {
    const off = slotsStart + i * 14;
    if (buf[off] !== 0x01 || buf[off + 1] !== 0x00 || buf[off + 2] !== 0x40 || buf[off + 3] !== 0x00) {
      return null; // pattern mismatch
    }
    slots.push({
      raw: buf[off + 4],
      level: Math.floor(buf[off + 4] / 4),
    });
  }
  return { slots, weapon: slots[0], armor: slots[1], experience: slots[2] };
}

// ── Religion percentages per settlement ────────────────────────────────────
//
// Each settlement record contains a 6-byte block of religion-share percentages
// (one byte per religion in descr_religions). Values are 0..100 and sum to
// approximately 95..105 (rounding). The offset relative to the settlement
// name position VARIES per settlement (observed +137 / +139 / +152 across
// the cracking session); the values themselves never exceed 100 and the
// row-sum is the reliable signature.
//
// scanReligionForSettlement walks a small window forward from the name
// position looking for a 6-byte run that:
//   1. Has each byte in [0, 100]
//   2. Sums to within [90, 110]
//   3. Contains at least 2 non-zero entries (rules out dominant-100 outliers)
// Returns the first matching block plus its dx for reproducibility.
function scanReligionForSettlement(buf, namePos, windowSize = 200) {
  for (let dx = 0; dx < windowSize; dx++) {
    const off = namePos + dx;
    if (off + 6 > buf.length) break;
    let sum = 0, nonZero = 0, ok = true;
    for (let i = 0; i < 6; i++) {
      const b = buf[off + i];
      if (b > 100) { ok = false; break; }
      sum += b;
      if (b > 0) nonZero++;
    }
    if (!ok) continue;
    if (sum < 90 || sum > 110) continue;
    if (nonZero < 2) continue;
    return { dx, sum, bytes: Array.from(buf.slice(off, off + 6)) };
  }
  return null;
}

// Parse religion for every settlement marker passed in.
// Returns Map<settlementName, { dx, sum, bytes }>.
function parseReligionByCity(buf, settlementMarkers) {
  const out = {};
  if (!Array.isArray(settlementMarkers)) return out;
  for (const s of settlementMarkers) {
    const namePos = s.offset + 1;
    const r = scanReligionForSettlement(buf, namePos);
    if (r) out[s.name] = r;
  }
  return out;
}

module.exports = {
  parseHeader,
  parseFactionDiscoveredBitmask,
  parseFactionConfigRecords,
  parseModInfo,
  parseCharacterExtras,
  attachMapCoords,
  resolvePortraitsByCharacter,
  parseFactionTreasuries,
  parseFactionDiplomacy,
  findRegionRecords,
  buildFamilyTreeMaps,
  parseSoldierArray,
  parseUnitStatSlots,
  scanReligionForSettlement,
  parseReligionByCity,
};
