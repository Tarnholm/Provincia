// serialize.js — re-serializer SKELETON for the rebuild-saves goal.
//
// Parses a .sav, reconstructs an output buffer by walking every byte of the
// file (claimed sections + unclaimed gaps) in OFFSET order, then compares
// the result to the input byte-for-byte.
//
// At today's coverage (94.37%), almost every section is implemented as
// PASSTHROUGH: `return inputBytes.slice(start, end)`. That is still useful —
// it proves the round-trip-test infrastructure (claim enumeration, gap-fill,
// concat assembly, byte-level diff) works end-to-end. Once individual
// serializers are written for real (e.g. building chains, faction records),
// they slot into the same dispatch table without changing the harness.
//
// Usage:  node serialize.js [savePath]
// Output: prints input size, output size, byte-identical Y/N, and (if not)
//         the first differing offset.
//
// Method:
//   1. Reuse cover.js's claim machinery to enumerate every section span.
//   2. Build a non-overlapping segment list covering [0..size):
//        - Sort claims by start offset.
//        - Merge claim ranges into NORMALIZED segments — earliest claim wins
//          a contested byte (matches how the bitmap dedupes).
//        - Fill UNKNOWN gaps with passthrough segments.
//   3. For each segment, call `serializeSection(name, buf, start, end)`.
//      Default impl: return `buf.slice(start, end)` (raw passthrough).
//   4. Concat all segment outputs in offset order.
//   5. Compare lengths + bytes against input; print first divergence.

"use strict";

const fs = require("fs");
const path = require("path");

const SAVE_PATH = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const MOD_DATA_DIR = "C:/RIS/RIS/data";
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");

const { findCharacterRecords } = require(path.join(PROVINCIA_SRC, "characterParser.js"));
const { findUnitRecords }      = require(path.join(PROVINCIA_SRC, "unitParser.js"));
const { findAllSettlementMarkers, scanChainsBetween } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));
const { findFactionRecords }   = require(path.join(PROVINCIA_SRC, "factionRecordParser.js"));
const { findLuaCounters }      = require(path.join(PROVINCIA_SRC, "luaCounterParser.js"));

// ---------------------------------------------------------------------------
// Mod-data loaders (same as cover.js).
// ---------------------------------------------------------------------------
function loadNameLookup(dir) {
  const p = path.join(dir, "descr_names_lookup.txt");
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map(s => s.trim());
}
function loadTraitNames(dir) {
  const p = path.join(dir, "export_descr_character_traits.txt");
  const names = [];
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^Trait\s+(\S+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Claim enumeration — same constants and ranges as cover.js. We DO NOT use
// cover.js's bitmap; instead we collect a list of {start, end, name} entries,
// then merge them into a non-overlapping segmentation below.
// ---------------------------------------------------------------------------
function enumerateClaims(buf) {
  const size = buf.length;
  const claims = [];
  const push = (s, e, name) => {
    s = Math.max(0, s); e = Math.min(size, e);
    if (e > s) claims.push({ start: s, end: e, name });
  };

  // Fixed top-of-file structure
  push(0x0000,    0x3328,   "Header");
  push(0x3328,    0x3bad,   "HST");
  push(0x3bad,    0x3bad+8, "Body-root section header");
  push(0x43f8,    0x44e2,   "Toggle_fow/RNG counter");
  push(0x44e2,    0x2a25d,  "post-fow-35-stride-table");
  push(0x2a25d,   0x2d155,  "diplo-event-log");
  push(0x2d4a9,   0x618f8,  "diplo-slot-table");
  push(0x61c47,   0x846af,  "ZoneA-log-slots");
  push(0x846af,   0xa8beb,  "ZoneB-scripted-events");
  push(0xa8beb,   0xf8fd2,  "character-paths");
  push(0x14e5ac6, 0x1501615,"merc-pool-table");

  // Tile-grid matrix
  const GRID_START = 0xf8fd2;
  const GRID_END   = GRID_START + 240 * 238 * 267;
  push(GRID_START, GRID_END, "tile-grid-matrix");

  // Characters
  let nameLookup = null, traitNames = null;
  try {
    nameLookup = loadNameLookup(MOD_DATA_DIR);
    traitNames = loadTraitNames(MOD_DATA_DIR);
  } catch (_) { /* mod data optional */ }
  if (nameLookup && traitNames) {
    const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
    for (let i = 0; i < chars.length; i++) {
      const start = chars[i].offset - 47;
      const next  = i + 1 < chars.length ? chars[i + 1].offset - 47 : chars[i].offset + 800;
      const recEnd = Math.min(next, chars[i].offset + 800);
      push(start, recEnd, "character-record");
    }
  }

  // Units
  const units = findUnitRecords(buf);
  for (let i = 0; i < units.length; i++) {
    const start = units[i].offset - 24;
    const next  = i + 1 < units.length ? units[i + 1].offset - 24 : units[i].offset + 256;
    const recEnd = Math.min(next, units[i].offset + 256);
    push(start, recEnd, "unit-record");
  }

  // Factions
  for (const f of findFactionRecords(buf)) {
    push(f.offset, f.offset + f.size, "faction-record");
  }

  // Settlements + chains
  const SETT_START = 0xf85f00;
  const SETT_END   = 0x1f10c72;
  const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= SETT_START && s.offset < SETT_END);
  for (const s of setts) push(s.offset, s.blockEnd, "settlement-marker");
  for (let i = 0; i < setts.length; i++) {
    const prevEnd = i === 0 ? SETT_START : setts[i - 1].blockEnd;
    const chains = scanChainsBetween(buf, prevEnd, setts[i].offset, null, null);
    for (const c of chains) {
      const span = Math.min(c.size || 16, 4096);
      push(c.offset, c.offset + span, "building-chain");
    }
  }
  // Settlement-detail records (§9b)
  {
    const FC_MAGIC = Buffer.from([0xfc,0xfc,0xfc,0xfc,0x64,0x00,0x00,0x00,0x00]);
    const TOK_DEF  = Buffer.from("default_set");
    const TOK_HINT = Buffer.from("hinterland_region");
    const TOK_CORE = Buffer.from("core_building");
    for (let i = 0; i < setts.length; i++) {
      const rs = setts[i].blockEnd;
      const re = (i + 1 < setts.length) ? setts[i + 1].offset : SETT_END;
      if (re - rs < 256) continue;
      const fcIdx = buf.indexOf(FC_MAGIC, rs);
      const fcOk  = fcIdx >= 0 && fcIdx < rs + 64;
      const defIdx = buf.indexOf(TOK_DEF, rs);
      const defOk  = defIdx >= 0 && defIdx < Math.min(re, rs + 256);
      const hintIdx = buf.indexOf(TOK_HINT, rs);
      const hintOk  = hintIdx >= 0 && hintIdx < Math.min(re, rs + 512);
      const coreIdx = buf.indexOf(TOK_CORE, rs);
      const coreOk  = coreIdx >= 0 && coreIdx < Math.min(re, rs + 1024);
      let termOk = false;
      for (let p = Math.max(rs, re - 16); p + 4 <= re; p++) {
        if (buf[p] === 0xef && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) { termOk = true; break; }
      }
      const score = (fcOk?1:0)+(defOk?1:0)+(hintOk?1:0)+(coreOk?1:0)+(termOk?1:0);
      if (score >= 3) push(rs, re, "settlement-detail");
    }
  }

  // Siege block
  if (0x152f529 + 73 <= size) push(0x152f529, 0x152f529 + 73, "siege-block");

  // RLE shroud-mask records
  {
    const RLE_MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);
    const offs = [];
    let p = 0x1f48000;
    while (p < size - 8) {
      const i = buf.indexOf(RLE_MAGIC, p);
      if (i < 0) break;
      if (i >= 8 && buf.readUInt32LE(i - 8) === i - 8) offs.push(i - 8);
      p = i + 4;
    }
    for (let i = 0; i < offs.length; i++) {
      const start = offs[i] - 16;
      const end   = i + 1 < offs.length ? offs[i + 1] - 16 : offs[i] + 30000;
      push(start, end, "rle-shroud-mask");
    }
  }

  // Lua counters footer
  const counters = findLuaCounters(buf);
  if (counters.length > 0) push(counters[0].offset, counters[counters.length - 1].end, "lua-counters");

  return claims;
}

// ---------------------------------------------------------------------------
// Merge overlapping claims + fill gaps so the result is a strict partition
// of [0..size). First-claim-wins for contested bytes — same dedup semantics
// as cover.js's bitmap.
// ---------------------------------------------------------------------------
function buildSegments(claims, size) {
  const sorted = claims.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const segs = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.end <= cursor) continue;            // already covered
    if (c.start > cursor) {
      segs.push({ start: cursor, end: c.start, name: "UNKNOWN" });
    }
    const segStart = Math.max(c.start, cursor);
    segs.push({ start: segStart, end: c.end, name: c.name });
    cursor = c.end;
  }
  if (cursor < size) segs.push({ start: cursor, end: size, name: "UNKNOWN" });
  return segs;
}

// ---------------------------------------------------------------------------
// Per-section serializer dispatch.
//
// Today: most entries are PASSTHROUGH. Real serializers replace specific
// names with a `(buf, start, end) => Buffer` that re-emits from parsed
// state. The harness above is unchanged.
// ---------------------------------------------------------------------------

// ---- Header (0x0000..0x3328, 13096 bytes) ----------------------------------
//
// RESEARCH.md "Header layout" describes the first ~0x60 bytes. Past the
// campaign-name pstr16le the engine writes ~13KB of opaque settings (unit
// size, battle difficulty, season, year, etc. — see "Confirmed concrete
// fields" table). Those fields live at known relative offsets but we don't
// yet model every byte, so the decoder captures the structured prefix and
// the opaque tail as a raw Buffer. Encoder writes them back in order.
//
// Round-trip is invertible because:
//   - magic, padFlag, clock, zeros1, dim1, dim2, w1c, w1e, w20 are fixed-
//     width primitives.
//   - guid is a 16-byte blob.
//   - w34, w36, then a pstr16le campaign name (u16 length + UTF-16LE chars,
//     no NUL terminator confirmed by hexdump).
//   - everything after the campaign-name string is captured verbatim as
//     `tail` and re-emitted byte-for-byte.
function decodeHeader(buf, start, end) {
  if (start !== 0 || end !== 0x3328) {
    throw new Error(`decodeHeader: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0..0x3328)`);
  }
  const magic    = buf.readUInt16LE(start + 0x00);   // 0x070a
  const padFlag  = buf.readUInt16LE(start + 0x02);   // 0
  const clock    = buf.readUInt32LE(start + 0x04);   // float-bits / counter; keep raw u32
  const zeros1   = buf.slice(start + 0x08, start + 0x14);  // 12 bytes of zeros
  const dim1     = buf.readUInt32LE(start + 0x14);   // 1024
  const dim2     = buf.readUInt32LE(start + 0x18);   // 1024
  const w1c      = buf.readUInt16LE(start + 0x1c);   // 4
  const w1e      = buf.readUInt16LE(start + 0x1e);   // 2
  const w20      = buf.readUInt32LE(start + 0x20);   // 7
  const guid     = buf.slice(start + 0x24, start + 0x34);  // 16-byte GUID
  const w34      = buf.readUInt16LE(start + 0x34);   // 43653
  const w36      = buf.readUInt32LE(start + 0x36);   // 2 (schema?)
  const nameLen  = buf.readUInt16LE(start + 0x3a);   // pstr16le length in chars
  const nameOff  = start + 0x3c;
  const nameEnd  = nameOff + nameLen * 2;
  if (nameEnd > end) throw new Error(`decodeHeader: campaign name overruns header`);
  const campaignName = buf.slice(nameOff, nameEnd).toString("utf16le");
  const tail = Buffer.from(buf.slice(nameEnd, end));  // opaque remainder

  return {
    _kind: "header",
    magic, padFlag, clock,
    zeros1,
    dim1, dim2, w1c, w1e, w20,
    guid,
    w34, w36,
    campaignName,
    tail,
  };
}

function encodeHeader(h) {
  if (h._kind !== "header") throw new Error("encodeHeader: not a header object");
  const nameBuf = Buffer.from(h.campaignName, "utf16le");
  const nameLen = nameBuf.length / 2;
  const fixedLen = 0x3c;             // bytes before the pstr16le payload
  const out = Buffer.alloc(fixedLen + nameBuf.length + h.tail.length);

  out.writeUInt16LE(h.magic,    0x00);
  out.writeUInt16LE(h.padFlag,  0x02);
  out.writeUInt32LE(h.clock,    0x04);
  h.zeros1.copy(out, 0x08);                       // 12 bytes
  out.writeUInt32LE(h.dim1,     0x14);
  out.writeUInt32LE(h.dim2,     0x18);
  out.writeUInt16LE(h.w1c,      0x1c);
  out.writeUInt16LE(h.w1e,      0x1e);
  out.writeUInt32LE(h.w20,      0x20);
  h.guid.copy(out, 0x24);                          // 16 bytes
  out.writeUInt16LE(h.w34,      0x34);
  out.writeUInt32LE(h.w36,      0x36);
  out.writeUInt16LE(nameLen,    0x3a);
  nameBuf.copy(out, 0x3c);
  h.tail.copy(out, 0x3c + nameBuf.length);

  return out;
}

const SERIALIZERS = {
  // First real decode/encode pair: header. Proves round-trip framework.
  "Header": (buf, start, end) => encodeHeader(decodeHeader(buf, start, end)),
  // Add more real serializers here as they're written. Anything not listed
  // falls through to the default passthrough.
};

function serializeSegment(buf, seg) {
  const fn = SERIALIZERS[seg.name];
  if (fn) return fn(buf, seg.start, seg.end);
  return buf.slice(seg.start, seg.end);     // passthrough
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
function main() {
  const t0 = Date.now();
  const buf = fs.readFileSync(SAVE_PATH);
  const size = buf.length;
  console.log(`save:        ${SAVE_PATH}`);
  console.log(`input size:  ${size} bytes (${(size / 1048576).toFixed(2)} MB)`);

  const claims = enumerateClaims(buf);
  console.log(`claims:      ${claims.length}`);

  const segs = buildSegments(claims, size);
  const unknownSegs = segs.filter(s => s.name === "UNKNOWN");
  const unknownBytes = unknownSegs.reduce((a, s) => a + (s.end - s.start), 0);
  console.log(`segments:    ${segs.length} (${unknownSegs.length} UNKNOWN, ${unknownBytes} bytes)`);

  // Emit each segment.
  const chunks = new Array(segs.length);
  for (let i = 0; i < segs.length; i++) {
    chunks[i] = serializeSegment(buf, segs[i]);
  }
  const out = Buffer.concat(chunks);
  console.log(`output size: ${out.length} bytes`);

  // Compare.
  let identical = out.length === size;
  let firstDiff = -1;
  if (identical) {
    for (let i = 0; i < size; i++) {
      if (out[i] !== buf[i]) { identical = false; firstDiff = i; break; }
    }
  } else {
    // length mismatch — find first divergence up to min length
    const n = Math.min(out.length, size);
    for (let i = 0; i < n; i++) {
      if (out[i] !== buf[i]) { firstDiff = i; break; }
    }
    if (firstDiff < 0) firstDiff = n;
  }

  const dt = Date.now() - t0;
  console.log(`\n=== ROUND-TRIP RESULT ===`);
  console.log(`  byte-identical:    ${identical ? "YES" : "NO"}`);
  if (!identical) {
    console.log(`  first diff offset: 0x${firstDiff.toString(16)} (${firstDiff})`);
    if (firstDiff < size && firstDiff < out.length) {
      console.log(`  input  @diff:      0x${buf[firstDiff].toString(16).padStart(2, "0")}`);
      console.log(`  output @diff:      0x${out[firstDiff].toString(16).padStart(2, "0")}`);
    }
    // Locate which segment owns the diff offset.
    const owner = segs.find(s => firstDiff >= s.start && firstDiff < s.end);
    if (owner) console.log(`  diff segment:      ${owner.name} [0x${owner.start.toString(16)}..0x${owner.end.toString(16)})`);
  }
  console.log(`  elapsed:           ${dt} ms`);
}

main();
