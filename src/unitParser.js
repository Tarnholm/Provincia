// src/unitParser.js
//
// Unit record parser for Rome: Total War Remastered save files.
// Decodes unit name, region, commander UUID, soldier count.
//
// Discovery:
//   Unit records have format:
//     +0   uint16  nameLen
//     +2   ASCII   unit_name (e.g., "roman hastati") + null
//     +N   uint32  unit hash
//     +N+4 uint32  seed/id
//     +N+8 uint32  soldier count
//     +N+12 uint32 0
//     +N+16 uint8  region_len (in UTF-16 chars)
//     +N+17 uint8  0
//     +N+18 UTF-16 region name
//     +N+18+2*rlen uint32 0xffffffff (terminator)
//     +...  uint32 commander_uuid (character's secondary_uuid)

"use strict";

function findUnitRecords(buf) {
  const records = [];
  const seen = new Set();
  for (let i = 0; i < buf.length - 60; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 4 || len > 50) continue;
    const ns = i + 2, ne = ns + len - 1;
    if (buf[ne] !== 0) continue;
    let ok = true;
    for (let k = ns; k < ne; k++) {
      const c = buf[k];
      if (c === 0x20 || c === 0x27) continue; // space and apostrophe (e.g. "greek general's guard cavalry early")
      if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x5f || (c >= 0x30 && c <= 0x39))) { ok = false; break; }
    }
    if (!ok) continue;
    const name = buf.slice(ns, ne).toString("ascii");
    // Don't require a space — single-word names like `hoplites` and
    // `hypaspists` are common in Alex. Rely on the structural post-name
    // pattern (region marker + 0xffffffff terminator) to filter noise.
    if (seen.has(name + "@" + i)) continue;
    seen.add(name + "@" + i);

    // Scan forward for region name: [uint8 rlen][0x00][UTF-16 name][ff ff ff ff]
    let region = null;
    let regionEnd = -1;
    for (let q = ne + 1; q < ne + 50; q++) {
      const rlen = buf[q];
      if (rlen < 3 || rlen > 25 || buf[q + 1] !== 0) continue;
      const rs = q + 2, re = rs + rlen * 2;
      if (re + 4 > buf.length) continue;
      if (buf[re] !== 0xff || buf[re + 1] !== 0xff || buf[re + 2] !== 0xff || buf[re + 3] !== 0xff) continue;
      let ok2 = true, nm = "";
      for (let j = rs; j < re; j += 2) {
        if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok2 = false; break; }
        nm += String.fromCharCode(buf[j]);
      }
      if (ok2 && nm[0] >= "A" && nm[0] <= "Z") {
        region = nm;
        regionEnd = re + 4;
        break;
      }
    }
    if (!region) continue;

    // Two post-region layouts observed in RTW:R saves:
    //   Variant A (most unit records, including the "alexander" special
    //     bodyguard):
    //       +0..3   uint32   commander_uuid
    //       +4..7   uint32   prev_commander_uuid / other reference
    //       +8..11  uint32   current_soldiers
    //       +12..15 uint32   max_soldiers
    //   Variant B (regular general bodyguards like "greek general's guard
    //     cavalry early" and others):
    //       +0..3   uint32   0x00000015 (filler / flag)
    //       +4..7   uint32   commander_uuid
    //       +8..11  uint32   0
    //       +12..15 uint32   0
    //       +16..19 uint32   current_soldiers
    //       +20..23 uint32   max_soldiers
    // Detect variant by the value at +0: a real character uuid is
    // effectively never the small sentinel 0x15, so a 0x15 at +0 tells us
    // the record is variant B. The sentinel may take other small values
    // in other saves — the resilient test is "looks like a small int"
    // (< 256 and not zero) vs "looks like a uuid" (large uint32).
    let soldiers = 0, maxSoldiers = 0, commanderUuid = 0;
    if (regionEnd + 24 < buf.length) {
      const at0 = buf.readUInt32LE(regionEnd + 0);
      const at4 = buf.readUInt32LE(regionEnd + 4);
      const isVariantB = at0 > 0 && at0 < 256; // small-int filler, not a uuid
      if (isVariantB) {
        commanderUuid = at4;
        soldiers = buf.readUInt16LE(regionEnd + 16);
        maxSoldiers = buf.readUInt16LE(regionEnd + 20);
      } else {
        commanderUuid = at0;
        soldiers = buf.readUInt16LE(regionEnd + 8);
        maxSoldiers = buf.readUInt16LE(regionEnd + 12);
      }
    }
    // Sanity: soldiers/max should be 0-2000
    if (soldiers > 2000) soldiers = 0;
    if (maxSoldiers > 2000) maxSoldiers = 0;

    records.push({
      offset: i,
      name,
      region,
      commanderUuid: commanderUuid === 0 || commanderUuid === 0xffffffff ? null : commanderUuid,
      soldiers,
      maxSoldiers,
    });
    i = regionEnd;
  }
  return records;
}

module.exports = { findUnitRecords };
