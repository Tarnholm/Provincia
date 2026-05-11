// src/characterParser.js
//
// Character record parser for Rome: Total War Remastered save files.
// Decodes names, age, traits, portraits, family tree from .sav binary data.
//
// Discovery summary (full details in calibration/PROGRESS_LOG.md):
//   - Character records contain name indices into descr_names_lookup.txt.
//   - Age is encoded as `242 - byte[+26]`.
//   - Traits are stored at offset +308 as a list of
//     `[uint32 trait_id, uint16 level, uint16 _]` pairs, count at +302.
//   - Portrait paths follow the trait list as length-prefixed ASCII.
//   - Father UUID at +46 links to parent's record.
//
// This module works on a Buffer. It assumes the mod's
// `descr_names_lookup.txt` and `export_descr_character_traits.txt` are
// pre-loaded and passed in as arrays (index → name).

function findCharacterRecords(buf, nameLookup, traitNames, surnamesFilter) {
  // If a surnamesFilter is provided, only match characters whose last name is in it.
  // If null/undefined, do a broad scan using structural heuristics.
  const records = [];
  const seen = new Set();

  if (surnamesFilter) {
    const surnameIdx = new Map();
    for (const sn of surnamesFilter) {
      const idx = nameLookup.indexOf(sn);
      if (idx >= 0) surnameIdx.set(sn, idx);
    }
    for (const [sn, idx] of surnameIdx) {
      for (let i = 0; i < buf.length - 308; i++) {
        if (buf.readUInt32LE(i + 5) !== idx) continue;
        const cand = tryParseAt(buf, i, nameLookup, traitNames);
        if (cand && !seen.has(i)) { seen.add(i); records.push(cand); }
      }
    }
  } else {
    // Broad scan using structural validation only
    for (let i = 47; i < buf.length - 308; i++) {
      const cand = tryParseAt(buf, i, nameLookup, traitNames);
      if (cand && !seen.has(i)) {
        seen.add(i);
        records.push(cand);
        i += 100; // skip ahead
      }
    }
  }

  return records.sort((a, b) => a.offset - b.offset);
}

function tryParseAt(buf, i, nameLookup, traitNames) {
  const first = buf.readUInt32LE(i);
  if (first < 50 || first >= nameLookup.length) return null;
  const firstName = nameLookup[first];
  if (!firstName || firstName.length < 3) return null;
  if (firstName[0] < "A" || firstName[0] > "Z") return null;
  const gender = buf[i + 4];
  if (gender > 3) return null;
  // Two record layouts coexist in RTW:R saves:
  //   • LAYOUT_A (surnamed): firstName u32 (+0), gender (+4),
  //     lastName u32 (+5), padding (+9), …, 8 bytes 0xff (+18..+25)*,
  //     age byte (+26), …, traitCount u16 (+302), trait records (+308).
  //   • LAYOUT_B (single-name): lastName omitted, every field shifts
  //     -4. 0xff sentinel at +14..+21*; age (+22); traitCount (+298).
  //
  // *The 0xff slot is the FAST PATH anchor — most records have it. But
  // some records carry real values there (e.g. Aulus Gabinius once the
  // RomanConquerorMessapians trait fires in save_rome3: +18..+25 holds
  // a Cornelius_Scapula name index instead of 0xff sentinel). For those
  // records we fall through to a SLOW PATH that anchors on the trait
  // table itself: traitCount in valid range AND the first trait record
  // (u32 traitId, u16 level) being a real trait. That's hard to forge
  // by random bytes — there are only ~3800 valid trait ids out of 2^32,
  // and the level u16 is bounded.
  let layoutB = null;
  const matches = (off) => {
    const tcAt = off === 0 ? 302 : 298;
    const tsAt = off === 0 ? 308 : 304;
    if (i + tcAt + 2 > buf.length) return false;
    const tc = buf.readUInt16LE(i + tcAt);
    if (tc < 1 || tc > 200) return false;
    if (i + tsAt + 8 > buf.length) return false;
    const tid0 = buf.readUInt32LE(i + tsAt);
    if (tid0 >= traitNames.length || !traitNames[tid0]) return false;
    // Trait levels in RTW go higher than the small Threshold values you
    // see in descr files — internal levels for things like Factionleader
    // (60+ on the leader), FasterCharacters (50+), Estates (20+) are real.
    // Cap at 1000 just to filter random-byte garbage; real values stay
    // well under that.
    const lvl0 = buf.readUInt16LE(i + tsAt + 4);
    if (lvl0 > 1000) return false;
    return true;
  };
  // LAYOUT_A first: need a valid lastName.
  const lastA = buf.readUInt32LE(i + 5);
  const validLastA = lastA >= 50 && lastA < nameLookup.length
    && nameLookup[lastA] && nameLookup[lastA].length >= 3
    && nameLookup[lastA][0] >= "A" && nameLookup[lastA][0] <= "Z";
  if (validLastA && matches(0)) {
    layoutB = false;
  } else if (buf[i + 5] === 0 && matches(-4)) {
    // LAYOUT_B: byte +5 must be 0 (the would-be first byte of lastName
    // in LAYOUT_A) to discriminate from LAYOUT_A records.
    layoutB = true;
  } else {
    return null;
  }
  // Field-offset table per layout — every check that reads the body of
  // the record routes through it.
  const off = layoutB
    ? { pad9: 5, d34: 30, age: 22, role: 38, traitCount: 298, traitsStart: 304, fatherUuid: 42 }
    : { pad9: 9, d34: 34, age: 26, role: 42, traitCount: 302, traitsStart: 308, fatherUuid: 46 };
  if (buf[i + off.pad9] !== 0) return null;
  const d34 = buf[i + off.d34];
  if (d34 !== 0x00 && d34 < 0xf0) return null;
  const age = 242 - buf[i + off.age];
  if (age < 0 || age > 100) return null;
  const role = buf[i + off.role];
  if (role > 10) return null;
  const tc = buf.readUInt16LE(i + off.traitCount);
  if (tc > 200) return null;
  return parseCharacter(buf, i, nameLookup, traitNames, layoutB);
}

function parseCharacter(buf, offset, nameLookup, traitNames, layoutB = false) {
  // Field-offset table per layout (mirrors tryParseAt). LAYOUT_B is the
  // 4-bytes-shorter Greek/single-name variant; lastName is omitted and
  // every subsequent field moves -4.
  // Pre-record UUID fields (at -47 / -43) DON'T shift; only the in-record
  // offsets after the missing lastName u32 do. Verified on Milon's record:
  // his secondaryUuid (0xf48b2861, matches the greek-general unit cmd) is
  // at exactly record_start - 43, same as Roman characters.
  const off = layoutB
    ? { age: 22, role: 38, fatherUuid: 42, traitCount: 298, traitsStart: 304, primaryUuid: -47, secondaryUuid: -43 }
    : { age: 26, role: 42, fatherUuid: 46, traitCount: 302, traitsStart: 308, primaryUuid: -47, secondaryUuid: -43 };
  const first = buf.readUInt32LE(offset);
  const gender = buf[offset + 4];
  const last = layoutB ? 0 : buf.readUInt32LE(offset + 5);
  const age = 242 - buf[offset + off.age];
  // Fine-grained age timer at +86 u16 (LAYOUT_A) — save-cracker session 4
  // CONFIRMED at 96.8% match across 1304 Sparta-corpus chars. Value =
  // age × 64 + birth_offset; engine ticks +64 per turn, 4 turns per
  // year. Only accept when the implied years match the integer age
  // within 1 — the 3.2% gap is real (e.g. Aulus Gabinius in save_rome6
  // reads raw=0 at +86 despite being age 20). The basic `age` field
  // stays as the rounded integer for the rest of the code.
  let ageFineQuarter = null;
  if (!layoutB && offset + 86 + 2 <= buf.length) {
    const raw = buf.readUInt16LE(offset + 86);
    const yrs = Math.floor(raw / 64);
    const qtr = Math.floor((raw % 64) / 16); // 0..3, four quarters per year
    if (raw > 0 && yrs >= 0 && yrs < 200 && Math.abs(yrs - age) <= 1) {
      ageFineQuarter = { years: yrs, quarter: qtr, raw };
    }
  }
  const role = buf[offset + off.role];
  const fatherUuid = buf.readUInt32LE(offset + off.fatherUuid);
  // Clan-head / cognomen link at +18 u32 (LAYOUT_A only) — save-cracker
  // session 8 STRONG. Most chars have 0xffffffff sentinel; specific
  // characters bound to a Roman gens / patron clan have a name-lookup
  // index here. The adjacent u32 at +22 is a small enum (relationship
  // type — values 2 seen for both Aulus and Marcus pointing to
  // Cornelius_Scapula).
  let clanHead = null;
  if (!layoutB && offset + 22 + 4 <= buf.length) {
    const idx = buf.readUInt32LE(offset + 18);
    const relType = buf.readUInt32LE(offset + 22);
    if (idx !== 0xffffffff && idx < nameLookup.length && nameLookup[idx]) {
      clanHead = { name: nameLookup[idx], relType };
    }
  }
  // Children's primaryUuids — save-cracker session 13 CONFIRMED (218/218
  // parent-child hits in Rome T1, byte-identical reproduction across
  // sessions). 4-byte slot array; slot order is by birth, dead children
  // preserve their slot leaving "garbage" between active slots, so
  // filter sentinel 0xffffffff and only keep real uuids. The 4 slots
  // sit at +54..+66 (LAYOUT_A) / +50..+62 (LAYOUT_B).
  const childUuids = [];
  {
    const childStart = layoutB ? 50 : 54;
    for (let s = 0; s < 4; s++) {
      const o = offset + childStart + s * 4;
      if (o + 4 > buf.length) break;
      const u = buf.readUInt32LE(o);
      if (u && u !== 0xffffffff) childUuids.push(u);
    }
  }
  // Primary/secondary UUIDs sit BEFORE the record start (offset -47 / -43
  // for LAYOUT_A, -43 / -39 for LAYOUT_B). The shift is the same -4
  // pattern as the in-record fields.
  const primaryUuid = offset + off.primaryUuid >= 0 ? buf.readUInt32LE(offset + off.primaryUuid) : 0;
  const secondaryUuid = offset + off.secondaryUuid >= 0 ? buf.readUInt32LE(offset + off.secondaryUuid) : 0;
  const traitCount = buf.readUInt16LE(offset + off.traitCount);

  const traits = [];
  for (let i = 0; i < traitCount - 1; i++) { // last slot is terminator
    const tid = buf.readUInt32LE(offset + off.traitsStart + i * 8);
    const level = buf.readUInt16LE(offset + off.traitsStart + i * 8 + 4);
    if (tid >= traitNames.length) break;
    if (!traitNames[tid]) continue;
    traits.push({ id: tid, name: traitNames[tid], level });
  }

  // Ancillaries — save-cracker session 6 (2026-05-10) located them inline
  // in the character record between the trait block and the portrait
  // ASCII paths. Layout: after `traitCount*8` trait bytes, zero or more
  // `[u16=0, u16=ancId]` pairs followed by a single `[u16=0]` sentinel
  // and then the portrait length prefix. Sub-case A (most chars: ~68% in
  // save_rome6) has gap=-2 meaning the last trait slot's flag u16
  // overlaps with the portrait length prefix and there are 0 ancillaries
  // — we detect this by scanning for "data/" right at trait_end. The
  // 9-line parser (cross-validated 892/936 on save_rome6, 1237/1341 on
  // Sparta T4 End): find "data/" within 200 bytes, gap = position of
  // "data/" relative to trait_end, ancCount = (gap - 2 - 2) / 4.
  const ancillaries = [];
  {
    const trEnd = offset + off.traitsStart + traitCount * 8;
    // Scan up to 200 bytes for the "data/" portrait path prefix.
    let dataPos = -1;
    for (let i = 0; i < 200 && trEnd + i + 4 < buf.length; i++) {
      if (buf[trEnd + i] === 0x64 && buf[trEnd + i + 1] === 0x61 &&
          buf[trEnd + i + 2] === 0x74 && buf[trEnd + i + 3] === 0x61 &&
          buf[trEnd + i + 4] === 0x2f) { dataPos = i; break; }
    }
    if (dataPos === 0) {
      // gap == -2 sub-case: 0 ancillaries, last trait's flag overlaps.
    } else if (dataPos > 0 && (dataPos - 2) % 4 === 2) {
      // gap >= 2 sub-case: parse N = (gap-4)/4 entries.
      const ancCount = (dataPos - 2 - 2) / 4;
      let valid = true;
      const ids = [];
      for (let i = 0; i < ancCount; i++) {
        // Each entry: [u16=0 padding][u16 ancId]
        if (buf.readUInt16LE(trEnd + i * 4) !== 0) { valid = false; break; }
        ids.push(buf.readUInt16LE(trEnd + i * 4 + 2));
      }
      if (valid) {
        for (const id of ids) ancillaries.push({ id });
      }
    }
    // dataPos < 0 or malformed → leave ancillaries empty (5-7% of chars
    // in the corpus, mostly captain records with non-data/ portrait paths)
  }

  // Portraits: scan forward from trait end for length-prefixed ASCII paths
  let cursor = offset + off.traitsStart + traitCount * 8;
  const portraits = [];
  for (let tries = 0; tries < 400 && portraits.length < 2; tries++) {
    if (cursor + 3 > buf.length) break;
    const len = buf.readUInt16LE(cursor);
    if (len > 10 && len < 200) {
      let ok = true;
      for (let k = 0; k < len - 1; k++) {
        const c = buf[cursor + 2 + k];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
      }
      if (ok && buf[cursor + 2 + len - 1] === 0x00) {
        portraits.push(buf.slice(cursor + 2, cursor + 2 + len - 1).toString("ascii"));
        cursor += 2 + len;
        continue;
      }
    }
    cursor++;
  }

  // Derived role classification from traits (more reliable than byte +42)
  const isLeader = traits.some(t => t.name === "Factionleader");
  const isHeir = traits.some(t => t.name === "Factionheir");

  // Death detection — refined 2026-05-10 via save-cracker session 4.
  // The u32 at +30..+33 carries a death-marker sentinel `0xfffffef7`
  // (=-265 i32) when the character is dead, 0 when alive. CONFIRMED on
  // two independent same-turn deaths (Herakleides + Hierokles, Athens
  // T22). The original heuristic read byte +34 (LAYOUT_A) / +30
  // (LAYOUT_B) and treated >= 0xf0 as dead — that happened to work for
  // LAYOUT_B (byte 0 of the u32) but was reading the wrong byte for
  // LAYOUT_A. The u32 check is layout-agnostic.
  let isDead = false;
  if (offset + 34 <= buf.length) {
    const deathMarker = buf.readUInt32LE(offset + 30);
    isDead = deathMarker === 0xfffffef7;
  }

  return {
    offset,
    firstName: nameLookup[first] || `#${first}`,
    // LAYOUT_B has no lastName field — Greek/single-name characters get
    // null. Without this the parser defaulted last=0 → nameLookup[0] →
    // "Aaron", labelling every Greek leader as "Milon Aaron".
    lastName: layoutB ? null : (nameLookup[last] || `#${last}`),
    gender: gender === 1 ? "male" : gender === 2 ? "female" : "unknown",
    age,
    role,
    isLeader,
    isHeir,
    isDead,
    primaryUuid,
    secondaryUuid,
    fatherUuid: fatherUuid === 0 ? null : fatherUuid,
    portraits,
    traits,
    ancillaries,
    ageFineQuarter,
    clanHead,
    childUuids,
  };
}

// Given a character's secondaryUuid, find the unit record commanded by them
// and extract its region. Returns the region name (UTF-16 decoded) or null.
function findCharacterRegion(buf, secondaryUuid) {
  if (!secondaryUuid) return null;
  const uuidBuf = Buffer.alloc(4);
  uuidBuf.writeUInt32LE(secondaryUuid);
  // Find occurrences and check if preceded (within 1000 bytes) by a known bodyguard unit name
  const unitNames = ["tribunus militum", "roman general", "roman bodyguard"];
  let i = 0;
  while ((i = buf.indexOf(uuidBuf, i)) !== -1) {
    for (let p = Math.max(0, i - 1000); p < i; p++) {
      for (const un of unitNames) {
        if (p + un.length >= buf.length) continue;
        if (buf.slice(p, p + un.length).toString("ascii") !== un) continue;
        if (buf[p + un.length] !== 0) continue;
        // Scan forward for UTF-16 region name with 0xff 0xff 0xff 0xff terminator
        for (let q = p + un.length + 1; q < p + un.length + 100; q++) {
          const rlen = buf[q];
          if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue; // raised 2026-05-09 for RIS regions ≤35 chars
          const rs = q + 2, re = rs + rlen * 2;
          if (buf[re] !== 0xff || buf[re + 1] !== 0xff) continue;
          let name = "", ok = true;
          for (let j = rs; j < re; j += 2) {
            if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
            name += String.fromCharCode(buf[j]);
          }
          if (ok && name[0] >= "A" && name[0] <= "Z") return name;
        }
      }
    }
    i++;
  }
  return null;
}

// Group characters by family (lastName) and build parent→children links via UUID
function buildFamilyTree(characters) {
  const byLastName = {};
  for (const c of characters) {
    if (!byLastName[c.lastName]) byLastName[c.lastName] = [];
    byLastName[c.lastName].push(c);
  }
  // For each character, try to find their UUID by searching for it in others' fatherUuid.
  // (Character's own UUID is stored in the pre-record header at -47 but we can also
  //  infer it from who references them as father.)
  const uuidOfChar = new Map();
  for (const c of characters) {
    // Find any character whose fatherUuid we can attribute to c
    // Heuristic: the father of all c's children (same lastName, younger, referencing fatherUuid)
    for (const other of characters) {
      if (other.fatherUuid && other.lastName === c.lastName && other.age < c.age) {
        // This character might be father of `other`. But to know definitively,
        // we'd need to scan for c's UUID in the save. Skip for now.
      }
    }
  }

  // Link father pointers via UUID collection
  const uuidMap = new Map(); // uuid → character (inferred from being referenced)
  for (const c of characters) {
    if (c.fatherUuid != null) {
      // Someone with this UUID is the father — we can identify WHO by matching
      // but we don't have the UUID in the main record. Leave as raw uuid for now.
    }
  }

  return byLastName;
}

module.exports = {
  findCharacterRecords,
  parseCharacter,
  buildFamilyTree,
  findCharacterRegion,
};
