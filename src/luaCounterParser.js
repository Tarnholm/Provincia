// src/luaCounterParser.js
//
// Reads the Lua persistent-counter table from a Rome Remastered .sav. The
// engine stores every `declare_persistent_counter` value plus a few
// engine-internal counters in a contiguous block near EOF.
//
// CONFIRMED format (rtw-sav-parser/parser/records.py — RIS imperial,
// 2026-05-09):
//
//   counter_record:
//     uint32  name_length    (in UTF-16 code units; 1..100)
//     UTF-16LE name           (name_length code units = 2*name_length bytes)
//     uint32  value          (interpret as signed/unsigned/uuid depending on use)
//
// Records are contiguous. The chain ends ~280KB before EOF; the table sits
// just past sec[5] in our corpus.
//
// In RIS imperial campaign: 115 records totalling ~5300 bytes.
//
// Use cases for the companion app: read `turn_number`, faction internal
// IDs (id_sparta, id_romans_julii, ...), scripted-rebellion progress
// flags, battle counters, etc. without parsing the entire save body.

"use strict";

// Try to parse a single counter record at `off`. Returns null if shape
// doesn't match.
function tryParseAt(buf, off) {
  if (off + 8 > buf.length) return null;
  const n = buf.readUInt32LE(off);
  if (n < 1 || n > 100) return null;
  const nameStart = off + 4;
  const nameEnd = nameStart + n * 2;
  const valueEnd = nameEnd + 4;
  if (valueEnd > buf.length) return null;
  // Validate UTF-16LE printable ASCII (every odd byte is 0x00, every even
  // byte is in 0x20..0x7E).
  for (let j = nameStart; j < nameEnd; j += 2) {
    if (buf[j + 1] !== 0) return null;
    const c = buf[j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  // Build the name string.
  let name = "";
  for (let j = nameStart; j < nameEnd; j += 2) {
    name += String.fromCharCode(buf[j]);
  }
  // Counter names are identifier-shaped: [A-Za-z_][A-Za-z0-9_]*
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  return {
    offset: off,
    name,
    value: buf.readUInt32LE(nameEnd),
    end: valueEnd,
  };
}

// Locate the persistent-counter table and return all records.
//
// Strategy:
//   1. Use "turn_number" (UTF-16LE) as a high-confidence seed. Every RIS
//      imperial save has it; vanilla / other mods likely too if the
//      campaign script declares it.
//   2. Walk backward to find the table's first record.
//   3. Walk forward from the first record, parsing until a non-record
//      byte is hit.
function findLuaCounters(buf) {
  // Encode "turn_number" as UTF-16LE.
  const seedName = "turn_number";
  const seedBytes = Buffer.alloc(seedName.length * 2);
  for (let i = 0; i < seedName.length; i++) {
    seedBytes[i * 2] = seedName.charCodeAt(i);
    seedBytes[i * 2 + 1] = 0;
  }
  let seed = null;
  const seedPos = buf.lastIndexOf(seedBytes);
  if (seedPos >= 4) {
    seed = tryParseAt(buf, seedPos - 4);
  }
  if (!seed) {
    // Fallback: byte-stride scan in the last 512 KB.
    const scanStart = Math.max(0, buf.length - 512 * 1024);
    for (let off = scanStart; off + 8 < buf.length; off++) {
      const rec = tryParseAt(buf, off);
      if (!rec) continue;
      // Insist on a valid follow-up record OR being near EOF magic.
      const next = tryParseAt(buf, rec.end);
      if (next || buf.length - rec.end < 64) {
        seed = rec;
        break;
      }
    }
  }
  if (!seed) return [];

  // Walk backward to first record.
  let cur = seed;
  while (true) {
    let prev = null;
    // Try every possible name length from 1..100.
    for (let plen = 1; plen <= 100; plen++) {
      const candOff = cur.offset - 4 - plen * 2 - 4;
      if (candOff < 0) break;
      const rec = tryParseAt(buf, candOff);
      if (rec && rec.end === cur.offset) {
        prev = rec;
        break;
      }
    }
    if (!prev) break;
    cur = prev;
  }

  // Walk forward.
  const records = [];
  let cursor = cur.offset;
  while (cursor < buf.length) {
    const rec = tryParseAt(buf, cursor);
    if (!rec) break;
    records.push(rec);
    cursor = rec.end;
  }
  return records;
}

// Index by name for quick lookup. Returns Map<name, value>.
function indexCountersByName(records) {
  const m = new Map();
  for (const r of records) m.set(r.name, r.value);
  return m;
}

// Convenience: try to read a single named counter without enumerating the
// whole table. Falls back to the full scan if the seed can't be found.
function readCounter(buf, name) {
  const records = findLuaCounters(buf);
  for (const r of records) if (r.name === name) return r.value;
  return null;
}

module.exports = {
  findLuaCounters,
  indexCountersByName,
  readCounter,
};
