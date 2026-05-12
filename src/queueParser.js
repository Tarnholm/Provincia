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
//       entry+8  u32 chain_id
//       entry+16 u32 turns_remaining
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

function readQueueAtDefaultSet(buf, defaultSetOff) {
  const bodyStart = defaultSetOff + DEFAULT_SET.length;
  if (bodyStart + 12 > buf.length) return null;
  if (buf.readUInt32LE(bodyStart + 8) !== CHAIN_MAGIC) return null;
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

    if (u === 2 && i + 24 <= scanEnd) {
      const count = buf.readUInt32LE(i + 4);
      if (count < 1 || count > 16) continue;
      const chainId = buf.readUInt32LE(i + 8);
      const turns = buf.readUInt32LE(i + 16);
      if (chainId === 0 || chainId > 0xffffff) continue;
      // Validate by chain_id duplication elsewhere in the entry (session 36
      // observed it appears 3x: at +8, mid-entry, and near the trailer).
      let dupFound = false;
      for (let d = i + 20; d + 4 <= scanEnd && d < i + 53; d++) {
        if (buf.readUInt32LE(d) === chainId) { dupFound = true; break; }
      }
      if (!dupFound) continue;
      return { type: "building", chainId, turns, count, entryOff: i };
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

  // For each default_set position, decode its queue (if any). The body's
  // upper bound is conservatively the next default_set position (since
  // default_set is unique per settlement region).
  for (let p = 0; p < positions.length; p++) {
    const dsOff = positions[p];
    const q = readQueueAtDefaultSet(buf, dsOff);
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
    if (q.type === "building") bucket.building.push({ chainId: q.chainId, turns: q.turns, count: q.count });
    else if (q.type === "recruit") bucket.recruiting.push({ unit: q.unit });
  }

  return byCity;
}

module.exports = {
  readQueueAtDefaultSet,
  findAllDefaultSets,
  parseQueuesForSettlements,
};
