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
  const last = buf.readUInt32LE(i + 5);
  if (last < 50 || last >= nameLookup.length) return null;
  const lastName = nameLookup[last];
  if (!lastName || lastName.length < 3) return null;
  if (lastName[0] < "A" || lastName[0] > "Z") return null;
  if (buf[i + 9] !== 0) return null;
  const d34 = buf[i + 34];
  if (d34 !== 0x00 && d34 < 0xf0) return null;
  const age = 242 - buf[i + 26];
  if (age < 0 || age > 100) return null;
  const role = buf[i + 42];
  if (role > 10) return null;
  const tc = buf.readUInt16LE(i + 302);
  if (tc > 200) return null;
  // Relaxed: don't require primary_uuid at -47 (some characters may be stored differently)
  // if (i >= 47 && buf.readUInt32LE(i - 47) === 0) return null;
  return parseCharacter(buf, i, nameLookup, traitNames);
}

function parseCharacter(buf, offset, nameLookup, traitNames) {
  const first = buf.readUInt32LE(offset);
  const gender = buf[offset + 4];
  const last = buf.readUInt32LE(offset + 5);
  const age = 242 - buf[offset + 26];
  const role = buf[offset + 42];
  const fatherUuid = buf.readUInt32LE(offset + 46);
  // Primary UUID (used in father references) is at offset -47 from record start.
  // Secondary UUID (used in army commander references) is at offset -43.
  const primaryUuid = offset >= 47 ? buf.readUInt32LE(offset - 47) : 0;
  const secondaryUuid = offset >= 43 ? buf.readUInt32LE(offset - 43) : 0;
  const traitCount = buf.readUInt16LE(offset + 302);

  const traits = [];
  for (let i = 0; i < traitCount - 1; i++) { // last slot is terminator
    const tid = buf.readUInt32LE(offset + 308 + i * 8);
    const level = buf.readUInt16LE(offset + 308 + i * 8 + 4);
    if (tid >= traitNames.length) break;
    if (!traitNames[tid]) continue;
    traits.push({ id: tid, name: traitNames[tid], level });
  }

  // Portraits: scan forward from trait end for length-prefixed ASCII paths
  let cursor = offset + 308 + traitCount * 8;
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

  // Death detection: the bytes at +34..+37 flip from 00 to ff when a character
  // dies. This is more reliable than "adult with 0 traits" because women and
  // young adults sometimes have 0 traits while alive.
  const deathByte = buf[offset + 34];
  const isDead = deathByte >= 0xf0;

  return {
    offset,
    firstName: nameLookup[first] || `#${first}`,
    lastName: nameLookup[last] || `#${last}`,
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
          if (rlen < 3 || rlen > 25 || buf[q + 1] !== 0) continue;
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
