// src/buildingParser.js
//
// Settlement building parser — decodes built buildings per settlement from
// RTW:R save files. Based on the INVERSE block model discovered via the
// user's mic_1 demolish experiment (before/after diff confirmed which byte
// range belongs to which settlement).
//
// Model:
//   - Each settlement has a UTF-16 name marker: [\x01 nchars \x00 UTF-16 \0\0]
//   - Chain records for settlement S live BETWEEN (previous settlement's name)
//     and S's name. NOT after S as previously assumed.
//   - A chain record's presence = that chain is BUILT. No record = not built.
//   - Chain record format: [uint16 len][ASCII chain name][\x00][hash][per-level data]
//
// Verified:
//   - Eddopolis (Dummies capital): hinterland_region + core_building + mic_1 =
//     matches descr_strat and in-game UI.
//   - After demolishing mic_1: only hinterland_region + core_building remain.

"use strict";

function findAllSettlementMarkers(buf) {
  // Settlement markers: [flag_byte, nchars, 0x00, UTF-16 name, TERMINATOR].
  // Empirically the flag byte is either 0x01 (most common — "has built
  // chains / active settlement") or 0x00 (seen in Alex saves for Sparta
  // at turn start before the player constructs anything there). Accept
  // both so partially-populated settlements aren't missed.
  //
  // The post-name TERMINATOR is a little-endian uint32 holding a small count N
  // (cracked 2026-05-31 on the RIS v7.2 crash saves; see
  // findings-unit-attribution-2026-05-31.md). The OLD code required N == 0 (it
  // only checked the first two bytes were `00 00`), so it silently dropped every
  // settlement whose marker carried a non-zero N — ~140 of 1310 settlements on
  // the mid/late Turn-5/8/34 RoR saves (e.g. Rome N=2, Vienna N=2, Athens N=3,
  // Syracuse N=4). Each dropped settlement orphaned its garrison + field units,
  // pinning unit attribution at 55-65%. Accepting N in 0..4 brings settlement
  // coverage to 1309/1310 on every crash save with ZERO noise names (each
  // recovered marker resolves to a real descr_regions name) and NO regression on
  // the variant-free Quicksave/T1 corpus. N>4 only adds coincidental false hits
  // (linear-growing dup matches) without improving coverage, so 4 is the cap.
  // blockEnd stays the 2-byte step past the name (the N-u32 + payload that
  // follows is settlement state, consumed like the old `00 00`, so the chain
  // scanner that walks BETWEEN markers is unaffected).
  const TERM_MAX = 4;
  const out = [];
  for (let i = 0; i < buf.length - 30; i++) {
    const flag = buf[i];
    if (flag !== 0x01 && flag !== 0x00) continue;
    const nc = buf[i + 1];
    if (nc < 3 || nc > 32 || buf[i + 2] !== 0) continue;
    const se = i + 3 + nc * 2;
    if (se + 4 > buf.length) continue;
    if (buf.readUInt32LE(se) > TERM_MAX) continue;
    let ok = true, name = "";
    for (let j = i + 3; j < se; j += 2) {
      const lo = buf[j], hi = buf[j + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      name += String.fromCharCode(lo);
    }
    if (ok && name[0] >= "A" && name[0] <= "Z") {
      out.push({ offset: i, name, blockEnd: se + 2 });
    }
  }
  return out;
}

function isChainName(buf, ns, ne) {
  // Chain names start lowercase and contain letters/digits/underscores. A few
  // legit chains carry an UPPERCASE suffix letter — notably governmentA/B/C/D
  // (the "direct rule" etc. buildings). The old all-lowercase rule dropped every
  // government building from every settlement (e.g. a freshly-built direct-rule
  // gov in a conquered town never showed). Allow uppercase and rely on the
  // caller's validChainNames whitelist to reject non-chain game-state strings.
  if (ne - ns < 3) return false;
  const first = buf[ns];
  if (!(first >= 0x61 && first <= 0x7a)) return false;
  for (let k = ns; k < ne; k++) {
    const c = buf[k];
    const okc = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x5f || (c >= 0x30 && c <= 0x39);
    if (!okc) return false;
  }
  return true;
}

function scanChainsBetween(buf, start, end, validChainNames, chainMaxLevels) {
  const out = [];
  for (let i = start; i < end - 4; i++) {
    const ln = buf.readUInt16LE(i);
    if (ln < 4 || ln > 48) continue;
    const ns = i + 2, ne = ns + ln - 1;
    if (ne >= end || buf[ne] !== 0) continue;
    if (!isChainName(buf, ns, ne)) continue;
    const name = buf.slice(ns, ne).toString("ascii");
    if (name === "default_set") continue;
    if (validChainNames && !validChainNames.has(name)) continue;
    // Chain record layout (verified by byte-diffing same save before/after
    // a core_building cheat-upgrade and a set_building_health cheat in Alex):
    //   offset 0..1   uint16 length = name.length + 1 (includes trailing null)
    //   offset 2..N   ASCII chain name
    //   offset N+2    0x00 terminator
    //   offset N+3..N+6  4-byte hash
    //   offset N+7    uint8 LEVEL (0-based index into chain's `levels` list)
    //   offset N+32   uint8 HEALTH (0..100, default 100)
    //   offset N+8..  remaining per-level state
    // Small records (< ~40 bytes, e.g. wonders like pyramids_and_sphinx)
    // don't have this layout — for those, default level = 0, health = null.
    const lvlAbs = i + 2 + name.length + 1 + 4; // = i + name.length + 7
    let level = 0;
    if (lvlAbs < end) {
      const b = buf[lvlAbs];
      const maxLvl = (chainMaxLevels && chainMaxLevels[name]) || 10;
      if (b <= maxLvl) level = b;
    }
    const healthAbs = i + name.length + 32;
    let health = null;
    if (healthAbs < end) {
      const h = buf[healthAbs];
      if (h >= 0 && h <= 100) health = h;
    }
    out.push({ offset: i, name, level, health });
  }
  // Compute each record's size = distance to next record (or end).
  for (let r = 0; r < out.length; r++) {
    const next = r + 1 < out.length ? out[r + 1].offset : end;
    out[r].size = next - out[r].offset;
  }
  return out;
}

// Parse all settlements + their built buildings AND queued (in-construction)
// chains.
//
// Built buildings: each has a full chain record (name + 4-byte hash + level
// + data). Size ≥ 50 bytes filters out small wonder stubs.
//
// Queued buildings: RTW inserts a short record into the settlement's region
// that references an existing chain by its 4-byte hash rather than by name.
// No name string appears in a queue entry — we recognise it by the hash
// matching one of the settlement's built chain record hashes. For Temple of
// Zeus queued in Sparta we confirmed the hash `b1 36 05 94` appears both in
// the built temple_of_governors record AND in the pre-chain region as a
// queue reference.
//
// Returns: { settlements: [{ name, buildings:[...], queued:[...] }] }
function parseSettlements(buf, validChainNames, chainMaxLevels) {
  const settlements = findAllSettlementMarkers(buf);
  const results = [];
  const BUILT_MIN_SIZE = 50;
  for (let i = 0; i < settlements.length; i++) {
    const cur = settlements[i];
    const prevEnd = i === 0 ? 0 : settlements[i - 1].blockEnd;
    const chains = scanChainsBetween(buf, prevEnd, cur.offset, validChainNames, chainMaxLevels);
    // Pass 1: classify by size and record each built chain's 4-byte hash.
    const seenBuilt = new Set();
    const seenQueued = new Set();
    const buildings = []; // [{ name, level }, ...]
    const queued = [];     // [name, ...]
    // hash (hex) → chain name for this settlement's built records.
    const hashToChain = new Map();
    for (const c of chains) {
      if (c.size < BUILT_MIN_SIZE) {
        if (seenQueued.has(c.name)) continue;
        seenQueued.add(c.name);
        queued.push(c.name);
      } else {
        if (seenBuilt.has(c.name)) continue;
        seenBuilt.add(c.name);
        buildings.push({ name: c.name, level: c.level, health: c.health });
        // Hash is at offset: record_start + 2(len) + name.length + 1(null).
        const hashOff = c.offset + 2 + c.name.length + 1;
        if (hashOff + 4 <= buf.length) {
          const h = buf.slice(hashOff, hashOff + 4).toString("hex");
          hashToChain.set(h, c.name);
        }
      }
    }
    // Pass 2: scan the gap BEFORE the first built chain for queue references.
    // Anywhere a 4-byte value matches a known built-chain hash is a queue
    // entry (same chain being upgraded to the next tier).
    //
    // Queue record layout (offsets relative to the chain-hash position,
    // verified by diffing turn-1-queue vs turn-2-start saves):
    //   +0   4-byte chain hash (matches built record's hash for same chain)
    //   +24  uint32 total turns to build
    //   +28  uint32 turns elapsed
    //   +32  uint32 percent complete (0..100, integer)
    const firstBuiltOffset = chains.find((c) => c.size >= BUILT_MIN_SIZE)?.offset ?? cur.offset;
    const queueScanEnd = firstBuiltOffset;
    for (let p = prevEnd; p + 4 <= queueScanEnd; p++) {
      const h = buf.slice(p, p + 4).toString("hex");
      const name = hashToChain.get(h);
      if (!name) continue;
      if (seenQueued.has(name)) continue;
      seenQueued.add(name);
      // Read the progress fields if they fit within the scan window.
      //   +24 u32 total turns, +28 u32 elapsed turns, +32 u32 percent (0..100)
      let percent = null, turnsTotal = null, turnsElapsed = null, turnsRemaining = null;
      if (p + 36 <= queueScanEnd) {
        const pct = buf.readUInt32LE(p + 32);
        if (pct >= 0 && pct <= 100) percent = pct;
        const tot = buf.readUInt32LE(p + 24);
        const ela = buf.readUInt32LE(p + 28);
        if (tot > 0 && tot < 1000) turnsTotal = tot;
        if (ela >= 0 && ela < 1000) turnsElapsed = ela;
        if (turnsTotal != null && turnsElapsed != null) {
          turnsRemaining = Math.max(0, turnsTotal - turnsElapsed);
        }
      }
      queued.push({ name, percent, turnsTotal, turnsElapsed, turnsRemaining });
      // Skip past this 36-byte queue record to avoid matching inside it.
      p += 35;
    }
    results.push({ name: cur.name, offset: cur.offset, buildings, queued });
  }
  return { settlements: results };
}

module.exports = {
  findAllSettlementMarkers,
  scanChainsBetween,
  parseSettlements,
};
