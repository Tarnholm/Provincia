// src/queueParser.js
//
// Parser for per-settlement recruitment and construction queues, anchored
// on the `default_set` chain that every settlement carries.
//
// Schema (session 36 of save-cracker, verified on RIS imperial save_1.2..4.2):
//   default_set ASCIIZ at offset D (12 B incl. \0)
//   body begins at D+12 and runs up to the next chain's preamble.
//
//   Header (~53 B from body start):
//     +0..+3   u32 self_ptr (= D+12)
//     +4..+7   u32 chain_uuid
//     +8..+11  fc fc fc fc magic
//     +12..+15 u32 = 0x011d
//     +16..+19 u32 = 0x0194
//     ... cached cost/upkeep/count fields (alignment varies ±1 byte)
//
//   Queue entry (optional, follows header). Layout depends on type tag:
//     BUILDING tag `02 00 00 00` at body offset 53:
//       entry+0  u32 type = 2
//       entry+4  u32 count
//       entry+8  u32 chain_id            (duplicated at +36; aids validation)
//       entry+12 u32 = 0                 (flags / reserved)
//       entry+16 u32 turns_total         (matches EDB `construction N`)
//       entry+20 u32 turns_elapsed       (counts up +1 each turn; 0 on T0)
//       entry+24 u32 gold_paid_in        (cumulative; rises ~cost/turns per turn)
//       entry+28..+52 trailer            (cached upkeep, copies of chain_id, etc.)
//       => turns_remaining = turns_total - turns_elapsed
//          (verified Arretium aT2/aT3/aT4 hinterland_region: +16=6 constant,
//           +20 = 1,2,3 across consecutive turns. See dig-build-queue-timing*.js)
//     RECRUIT: u32 == chain_uuid (header's +4) appears at body offset ~50:
//       entry+0  u32 queue_uuid (matches chain_uuid)
//       entry+4  u16 nameLen (incl. \0)
//       entry+6  ASCIIZ unit name (e.g. "roman leves\0")
//
// Because the header has slight per-save padding drift (cached_upkeep
// field shifts ±1B between empty and populated headers), the parser
// scans the body from offset ≥ 40 for the queue signature rather than
// reading at a fixed offset.

"use strict";

const DEFAULT_SET = Buffer.from("default_set\0", "ascii");
const CHAIN_MAGIC = 0xfcfcfcfc;
// Queue scan window. The chain header runs body[0..52] and an optional
// queue entry of ≤53 B follows. After that comes the next chain's preamble
// `[u32 size=0x0c][u32 self_ptr][u16 nameLen]`. We require the preamble's
// `size = 0x0c` sentinel within ~120 B to confirm the queue body ended.
const QUEUE_SCAN_FROM = 40;
const QUEUE_SCAN_TO = 120;

// Locate the next chain preamble after the default_set body. The preamble
// is `[u32 size=0x0c][u32 self_ptr][u16 nameLen]` where self_ptr is the
// taw-style self-pointer at its own file offset (i.e. ptr == i+4).
function findNextChainPreamble(buf, fromOff, maxScan) {
  const end = Math.min(fromOff + maxScan, buf.length - 10);
  for (let i = fromOff; i < end; i++) {
    if (buf.readUInt32LE(i) !== 0x0c) continue;
    const ptr = buf.readUInt32LE(i + 4);
    if (ptr !== i + 4) continue;
    const nameLen = buf.readUInt16LE(i + 8);
    if (nameLen < 4 || nameLen > 64) continue;
    return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Alexander / RR expansion decode (engine-gated; see readQueueAtDefaultSet).
//
// Block layout (block-relative, verified Macedon T1/T2 cribs 2026-06-05):
//   construction item: signature `47 bd 6f 87 10 41 40 d0` at blk+25,
//     type tag u32=2 at blk+37, target cost u32 at blk+41, turns-elapsed u8 at
//     blk+53, accumulated build POINTS u8 at blk+57. Build POINTS accrue to 100
//     at completion, so turns are DERIVABLE from the save (no EDB needed):
//     turnsTotal = round(100*elapsed/points), turnsRemaining = total − elapsed
//     (cross-turn verified Pella T1→T5, 2026-06-05). The building's IDENTITY is
//     NOT recoverable (no chain handle; positional is always core_building), so
//     we surface PROGRESS only, not which building.
//   recruit item: ASCII pstr16 unit name + `ff 00 ?? 01` cost marker.
//   block ends at the next chain preamble [u32 size=0x0b][u32 self_ptr=i+4]
//     [u16 nameLen][ascii name] (size is 0x0b here, not the RIS 0x0c).
const ALEX_BLOCK_SCAN = 512;
// Alexander construction-item signature (full form, an actively-building item).
const ALEX_SIG = Buffer.from([0x47, 0xbd, 0x6f, 0x87, 0x10, 0x41, 0x40, 0xd0]);

// Next-chain preamble for the Alexander layout: like findNextChainPreamble but
// accepts size 0x0b (RR) as well as 0x0c, and validates the ASCII chain name so
// a stray 0x0b inside the queue body can't be mistaken for the boundary.
function findNextChainPreambleAlex(buf, fromOff, maxScan) {
  const end = Math.min(fromOff + maxScan, buf.length - 12);
  for (let i = fromOff; i < end; i++) {
    const sz = buf.readUInt32LE(i);
    if (sz !== 0x0b && sz !== 0x0c) continue;
    if (buf.readUInt32LE(i + 4) !== i + 4) continue;
    const nameLen = buf.readUInt16LE(i + 8);
    if (nameLen < 4 || nameLen > 64) continue;
    const nameEnd = i + 10 + nameLen;
    if (nameEnd > buf.length || buf[nameEnd - 1] !== 0) continue;
    let ok = true;
    for (let k = i + 10; k < nameEnd - 1; k++) {
      const c = buf[k];
      if (!((c >= 0x61 && c <= 0x7a) || c === 0x5f)) { ok = false; break; }
    }
    if (!ok) continue;
    return i;
  }
  return -1;
}

function readQueueAtDefaultSetAlexander(buf, defaultSetOff) {
  const body = defaultSetOff + DEFAULT_SET.length;
  const preambleOff = findNextChainPreambleAlex(buf, body + 12, ALEX_BLOCK_SCAN);
  const blockEnd = preambleOff >= 0
    ? preambleOff
    : Math.min(body + ALEX_BLOCK_SCAN, buf.length);

  const recruiting = [];
  // Recruit entries sit between the (optional) building entry and the next
  // chain header: a pstr16 ASCII unit name (stored length includes the NUL)
  // confirmed by an `ff 00 ?? 01` recruit-cost marker a few bytes later.
  for (let o = body; o + 2 < blockEnd; o++) {
    const len = buf.readUInt16LE(o);
    if (len < 4 || len > 32) continue;
    const nameEnd = o + 2 + len;
    if (nameEnd > blockEnd || buf[nameEnd - 1] !== 0) continue;
    let ok = true, s = "";
    for (let k = 0; k < len - 1; k++) {
      const c = buf[o + 2 + k];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      s += String.fromCharCode(c);
    }
    if (!ok || !/^[a-z]/.test(s) || !/[ _]/.test(s)) continue;
    let isRecruit = false;
    for (let q = nameEnd; q < nameEnd + 16 && q + 4 < blockEnd; q++) {
      if (buf[q] === 0xff && buf[q + 1] === 0x00 && buf[q + 3] === 0x01) { isRecruit = true; break; }
    }
    if (!isRecruit) continue;
    recruiting.push({ unit: s });
    o = nameEnd; // skip past this entry
  }

  // Build queue: the full-form construction item in the default_set block.
  // Progress only (no building name — identity isn't stored). turns-remaining is
  // derived from build-points (→100 at completion); null until ≥1 turn elapsed.
  const building = [];
  const sigOff = buf.indexOf(ALEX_SIG, body);
  if (sigOff >= 25 && sigOff < blockEnd && buf.readUInt32LE(sigOff - 25 + 37) === 2) {
    const blk = sigOff - 25;
    const turnsElapsed = buf[blk + 53];
    const points = buf[blk + 57];
    const turnsTotal = points > 0 ? Math.round((100 * turnsElapsed) / points) : null;
    const turnsRemaining = turnsTotal != null ? Math.max(0, turnsTotal - turnsElapsed) : null;
    building.push({
      // No chainId/chainName: Alexander doesn't store the queued building's
      // identity (see header note) — UI shows generic "Construction" + progress.
      targetCost: buf.readUInt32LE(blk + 41),
      turnsElapsed, points,
      turnsTotal, turns: turnsTotal, turnsRemaining,
      progressPct: Math.max(0, Math.min(100, points)),
      count: 1,
    });
  }

  if (recruiting.length === 0 && building.length === 0) return null;
  return { type: "alex", recruiting, building };
}

// Global per-save engine detector. The Alexander/RR engine stamps a serialised
// object-version magic `10 41 40 d0` (used by its construction-item signature
// and recruit entries) that the RIS imperial / vanilla Rome engine never writes.
// Verified across 64 saves: present 5–7× in every Alexander save (even idle),
// 0× in every RIS/Rome save. indexOf is a single native scan (run once per save).
const ALEX_OBJ_MAGIC = Buffer.from([0x10, 0x41, 0x40, 0xd0]);
function detectEngine(buf) {
  return buf.indexOf(ALEX_OBJ_MAGIC) !== -1 ? "alex" : "ris";
}

function readQueueAtDefaultSet(buf, defaultSetOff, engine) {
  const bodyStart = defaultSetOff + DEFAULT_SET.length;
  if (bodyStart + 12 > buf.length) return null;
  if (buf.readUInt32LE(bodyStart + 8) !== CHAIN_MAGIC) return null;
  // Engine gate. The Alexander/RR expansion serialises the default_set block
  // with a different layout (construction-item signature + ASCII recruit names)
  // than RIS imperial / vanilla Rome. Engine is detected once per save (see
  // detectEngine) and passed in; standalone callers fall back to detecting it.
  // (Cracked 2026-06-05; see rtw-sav-parser findings-construction-recruit-queue-w2.)
  if (engine === undefined) engine = detectEngine(buf);
  if (engine === "alex") return readQueueAtDefaultSetAlexander(buf, defaultSetOff);
  const chainUuid = buf.readUInt32LE(bodyStart + 4);
  // Tightly bound the queue search using the next chain's preamble.
  const preambleOff = findNextChainPreamble(buf, bodyStart + 40, QUEUE_SCAN_TO);
  if (preambleOff < 0) return null;
  const bodyLen = preambleOff - bodyStart;
  // bodyLen == 53 → header only, no queue (matches session 36 baseline).
  // bodyLen == 88 → header + 35 B recruit entry.
  // bodyLen == 106 → header + 53 B building entry.
  if (bodyLen <= 53) return null;

  // Empirically: BUILDING queue tag `02 00 00 00` sits 53 B into the body;
  // RECRUIT queue's chain_uuid duplicate sits 50 B into the body. Scan a
  // narrow window once we know the body actually has a queue.
  const scanEnd = preambleOff - 4;
  for (let i = bodyStart + QUEUE_SCAN_FROM; i + 8 <= scanEnd; i++) {
    const u = buf.readUInt32LE(i);

    if (u === 2 && i + 28 <= scanEnd) {
      const count = buf.readUInt32LE(i + 4);
      if (count < 1 || count > 16) continue;
      const chainId = buf.readUInt32LE(i + 8);
      const turnsTotal = buf.readUInt32LE(i + 16);
      const turnsElapsed = buf.readUInt32LE(i + 20);
      if (chainId === 0 || chainId > 0xffffff) continue;
      // Sanity: elapsed should not exceed total by more than 1 (build either
      // pending or just-completed). Reject obviously corrupt rows.
      if (turnsTotal > 64 || turnsElapsed > turnsTotal + 1) continue;
      // Validate by chain_id duplication elsewhere in the entry (session 36
      // observed it appears 3x: at +8, mid-entry, and near the trailer).
      let dupFound = false;
      for (let d = i + 20; d + 4 <= scanEnd && d < i + 53; d++) {
        if (buf.readUInt32LE(d) === chainId) { dupFound = true; break; }
      }
      if (!dupFound) continue;
      const turnsRemaining = Math.max(0, turnsTotal - turnsElapsed);
      return {
        type: "building",
        chainId,
        // Back-compat: `turns` historically meant the value at +16 (which is
        // turns_total, NOT remaining — old callers may need updating).
        turns: turnsTotal,
        turnsTotal,
        turnsElapsed,
        turnsRemaining,
        count,
        entryOff: i,
      };
    }

    if (u === chainUuid && chainUuid !== 0 && i + 8 <= scanEnd) {
      const nameLen = buf.readUInt16LE(i + 4);
      if (nameLen < 2 || nameLen > 64) continue;
      const nameStart = i + 6;
      const nameEnd = nameStart + nameLen - 1;
      if (nameEnd > scanEnd) continue;
      let allAscii = true;
      for (let k = nameStart; k < nameEnd; k++) {
        const c = buf[k];
        if (c < 0x20 || c > 0x7e) { allAscii = false; break; }
      }
      if (!allAscii) continue;
      if (buf[nameEnd] !== 0) continue;
      const unit = buf.slice(nameStart, nameEnd).toString("ascii");
      return { type: "recruit", unit, entryOff: i };
    }
  }

  return null;
}

function findAllDefaultSets(buf) {
  const out = [];
  let idx = 0;
  while ((idx = buf.indexOf(DEFAULT_SET, idx)) !== -1) {
    out.push(idx);
    idx += 1;
  }
  return out;
}

// Returns: Map<settlementName, { recruiting: [{unit}], building: [{chainId,turns,count}] }>
//
// Settlement assignment uses the same scheme as buildingParser.parseSettlements:
// settlement S owns chains found in [prev.blockEnd, S.offset).
function parseQueuesForSettlements(buf, settlementMarkers) {
  const byCity = new Map();
  const positions = findAllDefaultSets(buf);
  if (positions.length === 0 || settlementMarkers.length === 0) return byCity;
  // Detect the engine once; every default_set in a save shares one layout.
  const engine = detectEngine(buf);

  // For each default_set position, decode its queue (if any). The body's
  // upper bound is conservatively the next default_set position (since
  // default_set is unique per settlement region).
  for (let p = 0; p < positions.length; p++) {
    const dsOff = positions[p];
    const q = readQueueAtDefaultSet(buf, dsOff, engine);
    if (!q) continue;
    // Find which settlement owns this default_set.
    // settlement S_i owns chains in [prev.blockEnd, S_i.offset).
    let owner = null;
    for (let i = 0; i < settlementMarkers.length; i++) {
      const cur = settlementMarkers[i];
      const prevEnd = i === 0 ? 0 : settlementMarkers[i - 1].blockEnd;
      if (dsOff >= prevEnd && dsOff < cur.offset) {
        owner = cur.name;
        break;
      }
    }
    if (!owner) continue;
    if (!byCity.has(owner)) byCity.set(owner, { recruiting: [], building: [] });
    const bucket = byCity.get(owner);
    if (q.type === "alex") {
      // Alexander/RR: recruit names + build PROGRESS (no building name — identity
      // isn't stored; turns-remaining derived from build-points).
      if (q.recruiting && q.recruiting.length) bucket.recruiting.push(...q.recruiting);
      if (q.building && q.building.length) bucket.building.push(...q.building);
    }
    else if (q.type === "building") bucket.building.push({
      chainId: q.chainId,
      turns: q.turns,                 // back-compat: == turnsTotal
      turnsTotal: q.turnsTotal,
      turnsElapsed: q.turnsElapsed,
      turnsRemaining: q.turnsRemaining,
      count: q.count,
    });
    else if (q.type === "recruit") bucket.recruiting.push({ unit: q.unit });
  }

  return byCity;
}

module.exports = {
  readQueueAtDefaultSet,
  findAllDefaultSets,
  parseQueuesForSettlements,
  detectEngine,
};
