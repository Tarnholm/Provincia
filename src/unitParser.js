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

    // Scan forward for region name: [uint8 rlen][0x00][UTF-16 name][marker u32]
    // Region max length 50 (RIS imperial has 22 regions exceeding 25 chars;
    // Bracarensia_Septentrionalis = 27, Oxyrhynchites-Herakleopolites_Nomoi = 35).
    //
    // Two post-region terminator variants observed:
    //   • `ff ff ff ff` (most units — old/persistent units)
    //   • small u32 (0..50, e.g. `0d 00 00 00`) — observed on freshly-recruited
    //     governor bodyguards in RoR T5 (Aulus Gabinius's "roman general"
    //     bodyguard at Taras). User report 2026-05-10: "a male character
    //     who is of age always has a bodyguard". The strict `ff ff ff ff`
    //     check rejected those records, hiding fresh bodyguards entirely.
    //
    // Validation: accept ANY 4-byte terminator if the u32 IMMEDIATELY
    // following it looks like a real commander UUID (large value, not 0,
    // not 0xffffffff). That's enough to filter out random byte sequences
    // while admitting both terminator variants.
    let region = null;
    let regionEnd = -1;
    for (let q = ne + 1; q < ne + 80; q++) {
      const rlen = buf[q];
      if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
      const rs = q + 2, re = rs + rlen * 2;
      if (re + 8 > buf.length) continue;
      // Decode UTF-16 region name.
      let ok2 = true, nm = "";
      for (let j = rs; j < re; j += 2) {
        if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok2 = false; break; }
        nm += String.fromCharCode(buf[j]);
      }
      // Region name must start with a letter. Originally required uppercase
      // ("A".."Z") to filter out random byte noise that happened to look
      // ASCII, but RTW stores the naval "region" as the lowercase string
      // "the sea" — every naval unit was being dropped on this check.
      // Allow lowercase too; the post-region 0xffffffff (or small+uuid)
      // terminator validation downstream is enough to keep noise out.
      if (!ok2) continue;
      const firstC = nm.charCodeAt(0);
      const isLetter = (firstC >= 0x41 && firstC <= 0x5a) || (firstC >= 0x61 && firstC <= 0x7a);
      if (!isLetter) continue;
      // Accept if the post-region marker is `ff ff ff ff` (variant 1) OR
      // looks like a small u32 (variant 2: 0..255, with the next u32 being
      // a plausible UUID).
      const term = buf.readUInt32LE(re);
      const next = buf.readUInt32LE(re + 4);
      const isFFFF = term === 0xFFFFFFFF;
      const isSmallWithUuidNext = term <= 255 && next !== 0 && next !== 0xFFFFFFFF && next > 0xFFFF;
      if (!isFFFF && !isSmallWithUuidNext) continue;
      region = nm;
      regionEnd = re + 4;
      break;
    }
    if (!region) continue;

    // Two post-region layouts observed in RTW:R saves:
    //   Variant A (most unit records):
    //       +0..3   uint32   commander_uuid
    //       +4..7   uint32   prev_commander_uuid / other reference
    //       +8..11  uint32   max_soldiers     (full-strength size)
    //       +12..15 uint32   current_soldiers (after losses)
    //   Variant B (regular general bodyguards / specialty units):
    //       +0..3   uint32   small filler (e.g. 0x00000015)
    //       +4..7   uint32   commander_uuid
    //       +8..11  uint32   0
    //       +12..15 uint32   0
    //       +16..19 uint32   max_soldiers
    //       +20..23 uint32   current_soldiers
    // Detect variant by the value at +0: a real character uuid is never
    // the small sentinel range 1..255.
    //
    // Note (2026-05-10): max/current order was reversed earlier — full-
    // strength units hide it (both fields equal), but a damaged equites
    // unit at 120/94 (raw) showed up as soldiers=120, max=94 — which the
    // UI then rendered as "122/96" instead of the correct "96/122". The
    // byte dump confirmed +8 holds max and +12 holds current.
    let soldiers = 0, maxSoldiers = 0, commanderUuid = 0;
    // Movement points remaining for the unit (bodyguard records mirror the
    // character's current MP here; non-bodyguard variant-A units have
    // something else at +4 and the value gets sanity-rejected below).
    // Save-cracker dossier 2026-05-10: f32 at commanderUuid + 4, drops by
    // ~7.4 per tile moved. Triple-validated against save_rome5..sav vs
    // save_rome6.sav (one Roman general moves 1 tile, only field that
    // changes is this float + a position byte).
    let movementPoints = null;
    if (regionEnd + 24 < buf.length) {
      const at0 = buf.readUInt32LE(regionEnd + 0);
      const at4 = buf.readUInt32LE(regionEnd + 4);
      const isVariantB = at0 > 0 && at0 < 256;
      if (isVariantB) {
        commanderUuid = at4;
        maxSoldiers = buf.readUInt16LE(regionEnd + 16);
        soldiers = buf.readUInt16LE(regionEnd + 20);
      } else {
        commanderUuid = at0;
        maxSoldiers = buf.readUInt16LE(regionEnd + 8);
        soldiers = buf.readUInt16LE(regionEnd + 12);
        if (commanderUuid && commanderUuid !== 0xffffffff) {
          const mp = buf.readFloatLE(regionEnd + 4);
          if (Number.isFinite(mp) && mp >= 10 && mp <= 500) movementPoints = mp;
        }
      }
    }
    // Unit XP / weapon / armour upgrade levels — save-cracker session 10
    // (2026-05-11). For VARIANT A only (variant B's offsets aren't pinned).
    // The cracker cross-validated 33,727 unit records:
    //   +16 u8 armour upgrade (0..3, hypothesis — never >0 in any sampled
    //     corpus since no armoury was built. Symmetry with +17 makes it
    //     the most likely armoury level).
    //   +17 u8 weapon upgrade (0..1 observed, CONFIRMED — matches
    //     descr_strat `weapon_lvl 1` for Macedonian phalangists/hypaspists
    //     and Roman early infantry).
    //   +20 u8 XP: low nibble holds chevron count 0..9; bit 0x80 is a
    //     separate "starting-roster" flag. CONFIRMED across Macedon T13→
    //     T14 turn-end where 3 units gained chevrons in the AI rotation.
    let xp = 0, weaponUpgrade = 0, armourUpgrade = 0;
    if (regionEnd + 20 < buf.length) {
      const at0 = buf.readUInt32LE(regionEnd + 0);
      const isVariantB = at0 > 0 && at0 < 256;
      if (!isVariantB) {
        const xpByte = buf[regionEnd + 20];
        if (xpByte != null) xp = xpByte & 0x0f; // strip 0x80 starting-roster flag
        const w = buf[regionEnd + 17];
        if (w != null && w <= 3) weaponUpgrade = w;
        const a = buf[regionEnd + 16];
        if (a != null && a <= 3) armourUpgrade = a;
      }
    }
    // Sanity: soldiers/max should be 0-2000
    if (soldiers > 2000) soldiers = 0;
    if (maxSoldiers > 2000) maxSoldiers = 0;

    // Fleet army uuid for naval records. Verified on save_rome10: every
    // FIRST ship in a fleet carries the army_uuid at u32 (i-20), and that
    // uuid matches a type-4 world-object position record. Multi-ship
    // fleets only carry the uuid on the first ship; later ships in the
    // same fleet have something else at -20 and need to inherit the prior
    // ship's fleetUuid via file-order proximity. We only attempt this for
    // naval-prefix names so non-naval units stay untouched. The caller
    // (main.js) does the file-order inheritance pass.
    let fleetUuid = null;
    if (/^naval\b/i.test(name) && i >= 20) {
      const candidate = buf.readUInt32LE(i - 20);
      if (candidate && candidate !== 0xffffffff) fleetUuid = candidate;
    }
    records.push({
      offset: i,
      name,
      region,
      commanderUuid: commanderUuid === 0 || commanderUuid === 0xffffffff ? null : commanderUuid,
      soldiers,
      maxSoldiers,
      fleetUuid,
      movementPoints,
      xp,
      weaponUpgrade,
      armourUpgrade,
    });
    i = regionEnd;
  }
  return records;
}

module.exports = { findUnitRecords };
