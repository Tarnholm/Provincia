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
    // Movement points remaining for the unit. The variant-A unit header is a
    // fixed 16-byte block at the post-region anchor (regionEnd):
    //   +0  u32  commanderUuid (0 for non-bodyguard units)
    //   +4  f32  movementPoints (MP remaining this turn)
    //   +8  u32  maxSoldiers
    //   +12 u32  currentSoldiers
    // Save-cracker dossier 2026-05-10: f32 at +4 drops by ~7.4 per tile moved
    // (triple-validated on a general moving 1 tile, save_rome5 vs save_rome6).
    //
    // 2026-05-31 (this session): the +4 float is the MP field for NON-bodyguard
    // combat units too, not just bodyguards. CONFIRMED by diffing the RoR
    // Turn-2-End → Turn-3-Start autosaves: across 3196 non-bodyguard units the
    // only header bytes that change are +4..+6 (the MP float) and +12 (current
    // soldiers); +0..+3 (uuid=0) and +8 (max) never change. At turn start the
    // float resets to a per-unit-type maximum — roman equites (cavalry) 216→241,
    // roman triarii/principes/hastati/leves (infantry) 166→185, naval 108/256 —
    // exactly the by-type MP refresh expected. The old code rejected these by
    // only reading MP when commanderUuid was set, so all line units showed
    // movementPoints=null. We now read +4 for any variant-A unit.
    let movementPoints = null;
    if (regionEnd + 24 < buf.length) {
      const at0 = buf.readUInt32LE(regionEnd + 0);
      const at4 = buf.readUInt32LE(regionEnd + 4);
      const isVariantB = at0 > 0 && at0 < 256;
      if (isVariantB) {
        commanderUuid = at4;
        maxSoldiers = buf.readUInt16LE(regionEnd + 16);
        soldiers = buf.readUInt16LE(regionEnd + 20);
        // Variant-B header is shifted (filler at +0, uuid at +4); the MP float
        // offset for this layout is not yet pinned, so leave movementPoints null.
      } else {
        commanderUuid = at0;
        maxSoldiers = buf.readUInt16LE(regionEnd + 8);
        soldiers = buf.readUInt16LE(regionEnd + 12);
        // Read MP at +4 for BOTH bodyguards (commanderUuid set) and line units
        // (commanderUuid == 0). Accept any finite float in a generous 0..2000
        // range — a fully-spent unit can read ~0 mid-turn, and naval/cavalry
        // maxima run higher than the old 10..500 bodyguard window.
        if (commanderUuid !== 0xffffffff) {
          const mp = buf.readFloatLE(regionEnd + 4);
          if (Number.isFinite(mp) && mp >= 0 && mp <= 2000) movementPoints = mp;
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
    // Smithy weapon/armor UPGRADE LEVEL — CRACKED & RIS-CONFIRMED 2026-06-01
    // (docs/findings-weapon-armor-2026-06-01.md + findings-ris-verify-h17-tax).
    // The upgrade level is a per-unit u8 in the IDENTITY block at H+17, where
    //   H = unit-hash = name-start (i) + 2 + nameLen   (nameLen incl trailing NUL).
    // Here `len` IS the nameLen (buf.readUInt16LE(i)) and `i` is the record
    // offset, so the hash sits at `i + 2 + len` and the upgrade byte at
    //   buf[i + 2 + len + 17].
    // It is a COMBINED weapon-or-armor upgrade level (the weapon-vs-armor SPLIT
    // is NOT yet distinguished — H+18/19/20 are 0 in every sampled unit, so the
    // two stats are not adjacent bytes). Range 0..4 observed, rare 9. We expose
    // it as a single generic `upgradeLevel`, NOT as the old +16/+17 regionEnd
    // bytes (those are static class attrs) and NOT as a weapon/armor split.
    // Validation ([[provincia-no-fallbacks]]): treat as unknown (null) — emit
    // NOTHING, not a fake 0 — if the value is implausible (>9) or any of the
    // confirmed-zero neighbours H+18/19/20 are non-zero (means we misaligned).
    let upgradeLevel = null;
    {
      const hashOff = i + 2 + len; // identity-block start H (the unit hash)
      const upOff = hashOff + 17;
      if (upOff + 3 < buf.length) {
        const v = buf[upOff];
        const n18 = buf[hashOff + 18];
        const n19 = buf[hashOff + 19];
        const n20 = buf[hashOff + 20];
        if (v <= 9 && n18 === 0 && n19 === 0 && n20 === 0) {
          upgradeLevel = v;
        }
      }
    }
    if (regionEnd + 20 < buf.length) {
      const at0 = buf.readUInt32LE(regionEnd + 0);
      const isVariantB = at0 > 0 && at0 < 256;
      if (!isVariantB) {
        const xpByte = buf[regionEnd + 20];
        if (xpByte != null) xp = xpByte & 0x0f; // strip 0x80 starting-roster flag
        // NOTE (2026-05-24): bytes +16 (armour) / +17 (weapon) were a session-10
        // hypothesis that does NOT hold. Across RIS Rome saves t1/t5/t7, +17 is
        // a STATIC binary attribute (~63% of units = 1, never >1 even at turn 7
        // after blacksmith upgrades exist) and +16 is always 0 — neither is a
        // blacksmith upgrade level (those range 0..3). Reading them painted a
        // false "+1 sword" on every unit that simply has a base weapon (e.g.
        // all Roman infantry). RIS's EDU has no weapon_lvl to subtract either,
        // so we leave both at 0 until the real per-unit upgrade source is found.
        // (xp at +20 stays — it is validated against chevron gains T13→T14.)
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
    // Passenger array on naval records (session 37 of save-cracker).
    // Schema: `[ship hash 4B][zeros 8B][u16 count][count × 4B passenger UUIDs]
    //          [u16 trailer][u16 nameLen]`. The trailer u16 immediately before
    // nameLen is fixed per ship-class (1, 2, or 3 observed) so we don't use
    // it as a marker. Find K by walking backward from nameLen 4 bytes at a
    // time, returning the first K where the u16 at `i - 4 - 4*K` equals K.
    let passengerUuids = null;
    if (/^naval\b/i.test(name) && i >= 4) {
      for (let K = 0; K <= 16; K++) {
        const co = i - 4 - 4 * K;
        if (co < 0) break;
        if (buf.readUInt16LE(co) !== K) continue;
        if (K === 0) { passengerUuids = []; break; }
        const arr = [];
        let valid = true;
        for (let u = 0; u < K; u++) {
          const v = buf.readUInt32LE(co + 2 + 4 * u);
          if (v === 0 || v === 0xffffffff) { valid = false; break; }
          arr.push(v);
        }
        if (valid) { passengerUuids = arr; break; }
      }
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
      upgradeLevel, // combined smithy weapon/armor upgrade level (H+17), 0..9 or null
      passengerUuids,
      _regionEnd: regionEnd, // internal anchor for offset probes (post-region terminator)
    });
    i = regionEnd;
  }
  // [unit-upgrade] diagnostic — provincia.log is the auto-update app's main
  // diagnosis window ([[provincia-feature-logging]]). Report how many parsed
  // units carry a non-zero smithy upgrade level, so a "no anvils visible"
  // report can be triaged as data-vs-render at a glance.
  try {
    const withUpgrade = records.filter(r => typeof r.upgradeLevel === "number" && r.upgradeLevel > 0).length;
    const unknown = records.filter(r => r.upgradeLevel == null).length;
    // eslint-disable-next-line no-console
    console.log(`[unit-upgrade] ${records.length} units parsed → ${withUpgrade} with upgradeLevel>0, ${unknown} unknown(null)`);
  } catch (e) { /* logging must never break parsing */ }
  return records;
}

module.exports = { findUnitRecords };
