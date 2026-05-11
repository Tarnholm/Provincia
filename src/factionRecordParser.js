// src/factionRecordParser.js
//
// Locates the 239 per-faction state records in a Rome Remastered .sav by
// scanning for the engine's signature magic. Each record is a fixed
// header (16 bytes) followed by per-faction state of variable length.
//
// CONFIRMED structure (rtw-sav-parser/parser/records.py — RIS imperial,
// 2026-05-09):
//
//   offset +0   4 bytes magic = ff 0a af f0
//   offset +4   uint32 self_pointer = record_offset + 4
//   offset +8   uint32 self_pointer = record_offset + 8
//   offset +12  4 bytes magic = f0 0a af f0
//   offset +16  uint32 = 0x3FC (= 1020) — purpose unknown (constant)
//   offset +20  uint32 = 0x2BC (=  700) — purpose unknown (constant)
//   offset +24..N  per-faction state (treasury, diplomacy, mercenaries,
//                   AI memory, etc.)
//
// Total record count = faction count from descr_strat (239 in RIS imperial,
// 21 in vanilla RTW). Records are variable-length; size = distance to next.
//
// Significance for the trim path: array span grows ~90 bytes / turn /
// faction. For a 400-turn campaign with 239 factions, that's ~8.6 MB of
// faction-state growth — likely the dominant byte cost in long campaigns.

"use strict";

const MAGIC_1 = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
const MAGIC_2 = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);

// Find every faction record. Each entry: { offset, size }.
// Validates the self-pointer + second magic to filter coincidental
// `ff 0a af f0` byte sequences elsewhere in the file.
function findFactionRecords(buf) {
  const positions = [];
  let p = 0;
  while (p < buf.length - 16) {
    const i = buf.indexOf(MAGIC_1, p);
    if (i < 0) break;
    if (i + 16 > buf.length) break;
    const sp = buf.readUInt32LE(i + 4);
    const magic2Match =
      buf[i + 12] === 0xf0 &&
      buf[i + 13] === 0x0a &&
      buf[i + 14] === 0xaf &&
      buf[i + 15] === 0xf0;
    if (sp !== i + 4 || !magic2Match) {
      p = i + 1;
      continue;
    }
    positions.push(i);
    p = i + 16;
  }
  if (positions.length === 0) return [];
  const out = new Array(positions.length);
  for (let r = 0; r < positions.length; r++) {
    const next = r + 1 < positions.length ? positions[r + 1] : buf.length;
    out[r] = {
      offset: positions[r],
      size: next - positions[r],
    };
  }
  return out;
}

// Convenience: array span (start..end) and total bytes.
function summarizeFactionArray(records) {
  if (!records.length) return null;
  const start = records[0].offset;
  const end = records[records.length - 1].offset + records[records.length - 1].size;
  return { count: records.length, start, end, totalBytes: end - start };
}

module.exports = {
  findFactionRecords,
  summarizeFactionArray,
  MAGIC_1,
  MAGIC_2,
};
