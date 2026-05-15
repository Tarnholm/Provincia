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

// ---- HST (Header Strings Table, 0x3328..0x3bad, 2181 bytes) ----------------
//
// The HST is the schema-version manifest: 106 entries of
//   [ASCIIZ name][u32 schema_version]
// per RESEARCH.md "Header strings table".
//
// The cover.js segment boundary [0x3328..0x3bad) does NOT align with the
// table boundaries:
//   - The actual entry count (u32=106) sits at 0x3310, which is INSIDE the
//     preceding Header segment and currently absorbed into header.tail.
//   - First entry "WORLD_MAP" begins at 0x3314.
//   - Segment-start 0x3328 falls inside the middle of entry [1]
//     "DIPLOMATIC_ATTITUDE" (the byte at 0x3328 is the 'A' of "ATIC_...").
//   - Entry [105] "POSITION" ends at 0x3b97, leaving 22 trailing bytes
//     before 0x3bad:
//       2 bytes  padding (0x0004)
//       4 bytes  next-section self-pointer (0x3b99)
//       4 bytes  next-section size (= 6488090, the body-root)
//       12 bytes start of body-root payload
//     These are owned by the cover.js "Body-root section header" claim that
//     follows, but spill into our segment because of the boundary mismatch.
//
// Decoder strategy (chosen to keep the boundary at 0x3328..0x3bad invertible):
//   1. prefixBytes: bytes from segment-start up to and including the NUL
//      that terminates the partial first ASCIIZ + the following u32 version.
//      Captured as raw Buffer so we don't need to know which entry it
//      belongs to.
//   2. entries: array of { name, version } pairs parsed normally until a
//      zero-length name (or until we reach the trailing raw zone).
//   3. trailerBytes: everything after the last full entry — currently
//      22 bytes for save_1.2.sav, but kept as opaque Buffer so the field
//      handles any save where the boundary mismatch is differently sized.
//
// Round-trip: prefixBytes + (name + NUL + u32 version per entry) + trailerBytes.

function decodeHST(buf, start, end) {
  if (start !== 0x3328 || end !== 0x3bad) {
    throw new Error(`decodeHST: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0x3328..0x3bad)`);
  }

  // 1. prefixBytes: scan to first NUL, then read 4-byte version.
  let p = start;
  while (p < end && buf[p] !== 0) p++;
  if (p >= end) throw new Error("decodeHST: no NUL in prefix region");
  p++;                                          // past NUL
  if (p + 4 > end) throw new Error("decodeHST: prefix version truncated");
  p += 4;                                       // past partial entry's u32 version
  const prefixBytes = Buffer.from(buf.slice(start, p));

  // 2. parse normal entries until trailing non-name byte appears.
  const entries = [];
  while (p < end) {
    // peek: must start with an A-Z byte to be a real entry.
    const b = buf[p];
    if (!(b >= 0x41 && b <= 0x5a)) break;       // not [A-Z] -> trailer begins
    let q = p;
    while (q < end && buf[q] !== 0) q++;
    if (q >= end) break;                        // no NUL in remainder
    const name = buf.slice(p, q).toString("latin1");
    if (q + 1 + 4 > end) break;                 // version would overrun
    const version = buf.readUInt32LE(q + 1);
    entries.push({ name, version });
    p = q + 1 + 4;
  }

  // 3. opaque trailer bytes — preserved verbatim.
  const trailerBytes = Buffer.from(buf.slice(p, end));

  return { _kind: "hst", prefixBytes, entries, trailerBytes };
}

function encodeHST(h) {
  if (h._kind !== "hst") throw new Error("encodeHST: not an hst object");
  const chunks = [h.prefixBytes];
  for (const e of h.entries) {
    const nameBuf = Buffer.from(e.name, "latin1");
    const entryBuf = Buffer.alloc(nameBuf.length + 1 + 4);
    nameBuf.copy(entryBuf, 0);
    entryBuf[nameBuf.length] = 0;
    entryBuf.writeUInt32LE(e.version, nameBuf.length + 1);
    chunks.push(entryBuf);
  }
  chunks.push(h.trailerBytes);
  return Buffer.concat(chunks);
}

// ---- Toggle_fow / RNG counter block (0x43f8..0x44e2, 234 bytes) ------------
//
// RESEARCH.md sessions 37 + 38:
//   - 0x43f8: u32 LE per-save tick counter (RNG/frame/serialization clock).
//     Increments every save; the 2-byte diff seen between two zero-input
//     saves was purely this u32 (e.g. 614 → 470, 4670 → 6062, etc.).
//   - 0x44e2: u8 toggle_fow cheat flag — 0x01 = FoW enabled (default),
//     0x00 = disabled after the console command. This byte sits in the
//     NEXT segment ("post-fow-35-stride-table" [0x44e2..0x2a25d)), so it
//     is NOT included in this decoder's range. Mentioned here only because
//     the surrounding ~234 bytes are the bracketing region named in cover.js
//     after the two diff anchors.
//
// Between the u32 counter at +0 and the end of this segment lie ~230 bytes
// of opaque engine state. No dossier maps those bytes to fields yet, so the
// decoder captures them verbatim as a Buffer. Encoder re-emits the u32 and
// the opaque tail in the same byte layout.
function decodeFowCounterBlock(buf, start, end) {
  if (start !== 0x43f8 || end !== 0x44e2) {
    throw new Error(`decodeFowCounterBlock: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0x43f8..0x44e2)`);
  }
  const counter = buf.readUInt32LE(start);          // per-save tick u32 LE
  const opaque  = Buffer.from(buf.slice(start + 4, end));
  return { _kind: "fow-counter-block", counter, opaque };
}

function encodeFowCounterBlock(b) {
  if (b._kind !== "fow-counter-block") throw new Error("encodeFowCounterBlock: not a fow-counter-block object");
  const out = Buffer.alloc(4 + b.opaque.length);
  out.writeUInt32LE(b.counter, 0);
  b.opaque.copy(out, 4);
  return out;
}

// ---- Tile-grid matrix (0xf8fd2..0xf84632, 240×238 × 267 bytes) -------------
//
// One contiguous array of 57,120 cells × 267-byte stride. Crosses the
// body-root boundary into the "9.78 MB tile-attribute gap". 42% of the save
// by byte count and the single largest structured region.
//
// Per-cell layout (per session 52 turn-diff + sessions 18/22/35):
//   +0    u32  global version constant (T1 = 5,  T2 = 6,   per-turn +1)
//   +8    u32  per-cell event field    (T1 = 0,  sparse non-zero in T2)
//   +12   u32  global version constant (T1 = 10, T2 = 11,  per-turn +1)
//   +20   u32  `prev` relation/state field (T1 default = 200; 16 cells
//              flip 200→600 in T2 — looks like AI-marked tiles)
//   +32   u32  `curr` relation/state field — also the anti-diagonal lazy
//              cache field (T1 = 200; T2 sweep flips to 195 in the
//              `col+row<237` half of the grid)
//   +68   u32  global version constant (T1 = 3,   T2 = 2,  per-turn −1)
//   +76   u32  global version constant (T1 = 0,   T2 = 1,  per-turn +1)
//   +84   u32  global version constant (T1 = 576, T2 = 577, per-turn +1)
//   +92   u32  global version constant (T1 = 0,   T2 = 0xFFFFFFFF, flip)
//
// All bytes outside those nine u32 slots (the 231 remaining bytes per cell)
// are preserved verbatim via a copy of the original 267-byte buffer; the
// encoder overwrites the nine structured u32 slots in place. This keeps the
// round-trip byte-identical for non-canonical cells (right edge, bottom row,
// anti-diagonal sentinel, 1,389 truly-interior non-canonical cells, etc.)
// without needing to model every byte yet.

const TG_START   = 0xf8fd2;
const TG_CELLS   = 240 * 238;        // 57,120
const TG_STRIDE  = 267;
const TG_END     = TG_START + TG_CELLS * TG_STRIDE;

function decodeTileGridMatrix(buf, start, end) {
  if (start !== TG_START || end !== TG_END) {
    throw new Error(`decodeTileGridMatrix: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0x${TG_START.toString(16)}..0x${TG_END.toString(16)})`);
  }
  const cells = new Array(TG_CELLS);
  for (let i = 0; i < TG_CELLS; i++) {
    const base = start + i * TG_STRIDE;
    cells[i] = {
      v0:     buf.readUInt32LE(base + 0),
      e8:     buf.readUInt32LE(base + 8),
      v12:    buf.readUInt32LE(base + 12),
      prev:   buf.readUInt32LE(base + 20),
      curr:   buf.readUInt32LE(base + 32),
      v68:    buf.readUInt32LE(base + 68),
      v76:    buf.readUInt32LE(base + 76),
      v84:    buf.readUInt32LE(base + 84),
      v92:    buf.readUInt32LE(base + 92),
      // Verbatim 267-byte copy; encoder rewrites only the nine u32 slots
      // and keeps every other byte byte-identical.
      opaque: Buffer.from(buf.slice(base, base + TG_STRIDE)),
    };
  }
  return { _kind: "tile-grid-matrix", cells };
}

function encodeTileGridMatrix(g) {
  if (g._kind !== "tile-grid-matrix") throw new Error("encodeTileGridMatrix: not a tile-grid-matrix object");
  if (g.cells.length !== TG_CELLS) throw new Error(`encodeTileGridMatrix: expected ${TG_CELLS} cells, got ${g.cells.length}`);
  const out = Buffer.alloc(TG_CELLS * TG_STRIDE);
  for (let i = 0; i < TG_CELLS; i++) {
    const c = g.cells[i];
    if (c.opaque.length !== TG_STRIDE) throw new Error(`encodeTileGridMatrix: cell ${i} opaque length ${c.opaque.length} !== ${TG_STRIDE}`);
    const base = i * TG_STRIDE;
    c.opaque.copy(out, base);
    out.writeUInt32LE(c.v0,   base + 0);
    out.writeUInt32LE(c.e8,   base + 8);
    out.writeUInt32LE(c.v12,  base + 12);
    out.writeUInt32LE(c.prev, base + 20);
    out.writeUInt32LE(c.curr, base + 32);
    out.writeUInt32LE(c.v68,  base + 68);
    out.writeUInt32LE(c.v76,  base + 76);
    out.writeUInt32LE(c.v84,  base + 84);
    out.writeUInt32LE(c.v92,  base + 92);
  }
  return out;
}

// ---- character-paths section (0xa8beb..0xf8fd2, ~321 KB) -------------------
//
// Per session 55: the CHARACTER_PATHS section, one record per on-map
// character. Each record has a 16-byte frame:
//   +0..+3  u32 LE  selfPtr          (== record start absolute offset)
//   +4..+7  u32 LE  groupSize        (per-record group/chain length; not body)
//   +8..+(stride-9)   variable body  (waypoint segments — see session 55)
//   +(stride-8)..+(stride-5) u32 LE  trailerSelfPtr  (== trailer absolute offset)
//   +(stride-4)..+(stride-1) u32 LE  characterUuidHash (the actor-uuid hash
//                                    session 26 found in the event log)
//
// 1,703 records walk wall-to-wall from 0xa8beb to 0xf8cd6. After the last
// per-character record there is a single auxiliary record at 0xf8cd6 (stride
// 517) whose +509 trailer carries a small u32 (0xc8 = 200) instead of a
// character-UUID hash — same 16-byte framing, semantics unknown but kept
// inside `records[]` so the framing invariant holds. The remaining 247 bytes
// at 0xf8edb..0xf8fd2 are a small sparse footer (a few scattered small u32s
// then zeros) — captured verbatim in `tail`.
//
// Trailer location is NOT byte-aligned to 4 from record start (e.g. rec 0
// stride 133 places its trailer at +125, not +124 — there's a 1-byte
// segment-terminator at +124 per session 55's waypoint dump). The encoder
// preserves byte-identity by capturing each record's body as a raw Buffer
// rather than trying to model every waypoint segment yet.
//
// Round-trip strategy: re-emit selfPtr (u32) + groupSize (u32) + body
// (verbatim Buffer) + trailerSelfPtr (u32) + characterUuidHash (u32) for
// each record, then the opaque tail.
//
// Trailer scan: at each candidate q >= p+8, q is the trailer iff
//   (a) u32 LE @ q == q (self-equal), AND
//   (b) the next position q+8 also has u32 LE @ (q+8) == (q+8), starting a
//       new record — OR q+8 == END (last-record-of-zone case).
// The "next record selfPtr" sniff disambiguates real trailers from incidental
// self-equal u32s inside the waypoint stream (tile coords whose low bytes
// happen to land on a self-equal value).

const CP_START = 0xa8beb;
const CP_END   = 0xf8fd2;

function decodeCharacterPaths(buf, start, end) {
  if (start !== CP_START || end !== CP_END) {
    throw new Error(`decodeCharacterPaths: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0x${CP_START.toString(16)}..0x${CP_END.toString(16)})`);
  }
  const records = [];
  let p = start;
  while (p + 16 <= end) {
    if (buf.readUInt32LE(p) !== p) break;          // not a record header — stop
    // Scan forward byte-by-byte for the trailer.
    let q = p + 8, trailerFound = -1;
    while (q + 8 <= end) {
      if (buf.readUInt32LE(q) === q) {
        const next = q + 8;
        if (next === end) { trailerFound = q; break; }
        if (next + 4 <= end && buf.readUInt32LE(next) === next) {
          trailerFound = q;
          break;
        }
      }
      q++;
    }
    if (trailerFound < 0) break;                   // section tail starts here
    const groupSize = buf.readUInt32LE(p + 4);
    const body = Buffer.from(buf.slice(p + 8, trailerFound));
    const trailerSelfPtr = buf.readUInt32LE(trailerFound);
    const characterUuidHash = buf.readUInt32LE(trailerFound + 4);
    records.push({ offset: p, groupSize, body, trailerSelfPtr, characterUuidHash });
    p = trailerFound + 8;
  }
  // Anything left between the last record's end and `end` is the section
  // footer (sparse small u32s + zero padding for save_1.2.sav).
  const tail = Buffer.from(buf.slice(p, end));
  return { _kind: "character-paths", start, records, tail };
}

function encodeCharacterPaths(cp) {
  if (cp._kind !== "character-paths") throw new Error("encodeCharacterPaths: not a character-paths object");
  const chunks = [];
  let cursor = cp.start;
  for (const r of cp.records) {
    if (r.offset !== cursor) {
      throw new Error(`encodeCharacterPaths: record offset 0x${r.offset.toString(16)} doesn't match cursor 0x${cursor.toString(16)}`);
    }
    const trailerOff = r.offset + 8 + r.body.length;
    const recBuf = Buffer.alloc(8 + r.body.length + 8);
    recBuf.writeUInt32LE(r.offset, 0);             // selfPtr
    recBuf.writeUInt32LE(r.groupSize, 4);
    r.body.copy(recBuf, 8);
    recBuf.writeUInt32LE(r.trailerSelfPtr, 8 + r.body.length);
    recBuf.writeUInt32LE(r.characterUuidHash, 8 + r.body.length + 4);
    chunks.push(recBuf);
    cursor = trailerOff + 8;
  }
  chunks.push(cp.tail);
  return Buffer.concat(chunks);
}

// ---- post-fow-35-stride-table (0x44e2..0x2a25d, ~151 KB) -------------------
//
// Per sessions 57 + 66 dossier the diplomatic-event subsystem splits into
// three internal subtables:
//
//   - prefix (0x44e2..0x4556, 116 B): opaque ~29 u32 leadin captured as a
//     raw Buffer.
//   - head  (0x4556..0x5181, 3,115 B): 89-row × 35-byte slot table. Every
//     row carries the byte sequence `1e 00 00 00` at +31 (confirmed 89/89
//     for save_1.2.sav). Row 0 contains the literal u32 0x59 = 89, a
//     slot-count self-reference. 1 live + 11 sparse + 78 all-zero rows.
//   - body  (0x5181..0x2a25d, 151,772 B): stride-12 event records of layout
//     `[u32 seq][u32 UUID-hash][u16 sentinel][u16 sub-id]`. The 0x2001
//     sentinel fires at +8 in 10,343/12,647 records (~88%). The remaining
//     12% are leading zero records, mid-stream variants (0x2002, 0x200c),
//     and 47 trailing rows that use a 0x020c/0x020d variant first-byte
//     framing. Body length (151,772) is NOT a multiple of 12 — it has an
//     8-byte slack remainder after row 12,647.
//
// Because the body's record framing is positional and varies by save, the
// decoder keeps body bytes as a single opaque Buffer (per the session-70
// pattern). The head is decoded into 89 × 35-byte slot structs since its
// shape is invariant.
//
// Round-trip is byte-identical by construction:
//   encode = prefixBytes + ( slot.row verbatim Buffer ) × 89 + bodyBytes

const PFOW_START = 0x44e2;
const PFOW_END   = 0x2a25d;
const PFOW_HEAD_START = 0x4556;
const PFOW_HEAD_END   = 0x5181;
const PFOW_HEAD_ROWS  = 89;
const PFOW_HEAD_STRIDE = 35;

function decodePostFowStrideTable(buf, start, end) {
  if (start !== PFOW_START || end !== PFOW_END) {
    throw new Error(`decodePostFowStrideTable: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0x${PFOW_START.toString(16)}..0x${PFOW_END.toString(16)})`);
  }
  const prefixBytes = Buffer.from(buf.slice(start, PFOW_HEAD_START));
  const slotTable = new Array(PFOW_HEAD_ROWS);
  for (let r = 0; r < PFOW_HEAD_ROWS; r++) {
    const off = PFOW_HEAD_START + r * PFOW_HEAD_STRIDE;
    slotTable[r] = {
      // Slot-count self-reference at row 0 +24: u32 LE = 0x59 = 89.
      slotCount: buf.readUInt32LE(off + 24),
      // Tail sentinel at +31..+34 = `1e 00 00 00` for every row.
      sentinel:  buf.readUInt32LE(off + 31),
      // Full 35-byte row preserved verbatim — encoder re-emits this and
      // ignores the parsed slotCount/sentinel fields above (which are
      // informational mirrors of bytes already inside `row`).
      row:       Buffer.from(buf.slice(off, off + PFOW_HEAD_STRIDE)),
    };
  }
  const bodyBytes = Buffer.from(buf.slice(PFOW_HEAD_END, end));
  return { _kind: "post-fow-35-stride-table", prefixBytes, slotTable, bodyBytes };
}

function encodePostFowStrideTable(t) {
  if (t._kind !== "post-fow-35-stride-table") throw new Error("encodePostFowStrideTable: not a post-fow-35-stride-table object");
  if (t.slotTable.length !== PFOW_HEAD_ROWS) throw new Error(`encodePostFowStrideTable: expected ${PFOW_HEAD_ROWS} slots, got ${t.slotTable.length}`);
  const chunks = [t.prefixBytes];
  for (let r = 0; r < PFOW_HEAD_ROWS; r++) {
    const slot = t.slotTable[r];
    if (slot.row.length !== PFOW_HEAD_STRIDE) throw new Error(`encodePostFowStrideTable: slot ${r} row length ${slot.row.length} !== ${PFOW_HEAD_STRIDE}`);
    chunks.push(slot.row);
  }
  chunks.push(t.bodyBytes);
  return Buffer.concat(chunks);
}

// ---- diplo-event-log (0x2a25d..0x2d155, ~12 KB) ----------------------------
//
// Per session 57: 1,002 × 12-byte tail event-log records. Layout per record:
//   +0  u8   type   (0x01 = event, 0x04 = separator)
//   +1  u8   flag
//   +2  u16  sub-id
//   +4  u16  turn
//   +6  u16  0x0000 (constant zero pad)
//   +8  u32  cookie / payload hash
//
// For save_1.2.sav: 892 type-0x01 events + 110 type-0x04 separators = 1,002.
// No other type bytes occur, so the type field is decoded as-is and the
// encoder re-emits the same byte stream.
//
// Round-trip is byte-identical by construction.

const DEL_START = 0x2a25d;
const DEL_END   = 0x2d155;
const DEL_STRIDE = 12;
const DEL_ROWS = (DEL_END - DEL_START) / DEL_STRIDE;  // 1002

function decodeDiploEventLog(buf, start, end) {
  if (start !== DEL_START || end !== DEL_END) {
    throw new Error(`decodeDiploEventLog: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0x${DEL_START.toString(16)}..0x${DEL_END.toString(16)})`);
  }
  if ((end - start) % DEL_STRIDE !== 0) {
    throw new Error(`decodeDiploEventLog: range not a multiple of ${DEL_STRIDE}`);
  }
  const rows = (end - start) / DEL_STRIDE;
  const events = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const off = start + i * DEL_STRIDE;
    events[i] = {
      type:   buf.readUInt8(off + 0),
      flag:   buf.readUInt8(off + 1),
      subId:  buf.readUInt16LE(off + 2),
      turn:   buf.readUInt16LE(off + 4),
      pad:    buf.readUInt16LE(off + 6),
      cookie: buf.readUInt32LE(off + 8),
    };
  }
  return { _kind: "diplo-event-log", events };
}

function encodeDiploEventLog(d) {
  if (d._kind !== "diplo-event-log") throw new Error("encodeDiploEventLog: not a diplo-event-log object");
  const out = Buffer.alloc(d.events.length * DEL_STRIDE);
  for (let i = 0; i < d.events.length; i++) {
    const e = d.events[i];
    const off = i * DEL_STRIDE;
    out.writeUInt8(e.type,        off + 0);
    out.writeUInt8(e.flag,        off + 1);
    out.writeUInt16LE(e.subId,    off + 2);
    out.writeUInt16LE(e.turn,     off + 4);
    out.writeUInt16LE(e.pad,      off + 6);
    out.writeUInt32LE(e.cookie,   off + 8);
  }
  return out;
}

// ---- ZoneB scripted-events (0x846af..0xa8beb, ~145 KB) ---------------------
//
// Session 54 + session 73 dossier:
//   - 8-byte section header [u32 selfPtr=0x846af][u32 size=0x22].
//   - 34 named scripted-event records, each:
//       [u16 catLenP1][ASCIIZ category]
//       [u16 nameLenP1][ASCIIZ name]
//       [opaque payload]
//     The first record is the "historic"/"olympics" header pair with a 25-byte
//     payload; the remaining 33 records (volcano/earthquake/flood entries) have
//     33-byte payloads. We don't model the payload bytes — they hold the BC
//     year (i32), tile (X,Y), category-id flags, and trailing zeros, but the
//     decoder keeps them as opaque Buffers because round-trip identity only
//     requires verbatim preservation.
//   - Trailer (~146 KB): 5,633 fixed-size 26-byte per-tile event records
//     (decoded in sessions 22/26/30: u32 iter, u32 cat, u32 X, u32 Y, u32 hash,
//     u32 0xffffffff terminator + 2-byte next-rec preamble), followed by a
//     180-byte wonders section (preamble + 7 wonder records + 10B trailer).
//     The trailer is captured verbatim as a single Buffer.
//
// Decoder strategy: walk the pstr16+pstr16 pair stream from the section start
// until pairs stop appearing. Locate the boundary between the named-records
// section and the 26B-tail by scanning for the first occurrence of
// `ff ff ff ff` at offset +22 of two consecutive 26-byte windows after the
// last named pair's strings end. Capture every byte verbatim — round-trip
// is byte-identical.

const SE_START = 0x846af;
const SE_END   = 0xa8beb;

function readPstr16ScriptedEvent(buf, o, hardEnd) {
  if (o + 2 > hardEnd) return null;
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 < 2 || lenP1 > 128) return null;
  if (o + 2 + lenP1 > hardEnd) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[o + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(o + 2, o + 2 + lenP1 - 1).toString("latin1"), totalLen: 2 + lenP1 };
}

function decodeScriptedEvents(buf, start, end) {
  if (start !== SE_START || end !== SE_END) {
    throw new Error(`decodeScriptedEvents: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0x${SE_START.toString(16)}..0x${SE_END.toString(16)})`);
  }

  // Walk pstr16+pstr16 pair offsets across the region.
  const pairs = [];
  for (let o = start; o < end - 4; o++) {
    const r1 = readPstr16ScriptedEvent(buf, o, end);
    if (!r1) continue;
    const r2 = readPstr16ScriptedEvent(buf, o + r1.totalLen, end);
    if (!r2) continue;
    pairs.push({ off: o, cat: r1.str, name: r2.str, catTotal: r1.totalLen, nameTotal: r2.totalLen });
    o += r1.totalLen + r2.totalLen - 1;
  }
  if (pairs.length === 0) throw new Error("decodeScriptedEvents: no string pairs found");

  // Header bytes precede the first pair (section selfPtr + size).
  const headerBytes = Buffer.from(buf.slice(start, pairs[0].off));

  // Locate the start of the 26-byte tail by finding two consecutive windows
  // with 0xffffffff at relative offset +22 (the per-tile-event record's
  // 4-byte terminator that sits at body-end of every tail record).
  const lastPair = pairs[pairs.length - 1];
  const lastStringsEnd = lastPair.off + lastPair.catTotal + lastPair.nameTotal;
  let tailStart = -1;
  for (let p = lastStringsEnd; p + 52 <= end; p++) {
    if (buf[p + 22] === 0xff && buf[p + 23] === 0xff && buf[p + 24] === 0xff && buf[p + 25] === 0xff &&
        buf[p + 48] === 0xff && buf[p + 49] === 0xff && buf[p + 50] === 0xff && buf[p + 51] === 0xff) {
      tailStart = p;
      break;
    }
  }
  if (tailStart < 0) throw new Error("decodeScriptedEvents: could not locate tail-records section");

  // Each record's payload spans from its strings-end to the next pair's offset
  // (or to tailStart for the final pair).
  const records = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const stringsEnd = p.off + p.catTotal + p.nameTotal;
    const payloadEnd = i + 1 < pairs.length ? pairs[i + 1].off : tailStart;
    records.push({
      category: p.cat,
      name:     p.name,
      payload:  Buffer.from(buf.slice(stringsEnd, payloadEnd)),
    });
  }

  const trailerBytes = Buffer.from(buf.slice(tailStart, end));
  return { _kind: "scripted-events", headerBytes, records, trailerBytes };
}

function encodeScriptedEvents(s) {
  if (s._kind !== "scripted-events") throw new Error("encodeScriptedEvents: not a scripted-events object");
  const chunks = [s.headerBytes];
  for (const r of s.records) {
    const catBuf  = Buffer.from(r.category + "\0", "latin1");
    const nameBuf = Buffer.from(r.name + "\0", "latin1");
    const catRec  = Buffer.alloc(2 + catBuf.length);
    catRec.writeUInt16LE(catBuf.length, 0);
    catBuf.copy(catRec, 2);
    const nameRec = Buffer.alloc(2 + nameBuf.length);
    nameRec.writeUInt16LE(nameBuf.length, 0);
    nameBuf.copy(nameRec, 2);
    chunks.push(catRec, nameRec, r.payload);
  }
  chunks.push(s.trailerBytes);
  return Buffer.concat(chunks);
}

// ---- merc-pool-table (0x14e5ac6..0x1501615, ~113 KB) -----------------------
//
// Per session 58 + session 75:
//   - ~50 KB binary "pool-state" pre-text zone holds the per-region pool slot
//     records (fixed-stride state with 1,524 hits of the `ac fe 45 12`
//     "empty-slot" sentinel — ~14.6 slots/region across 104 regions). The
//     stride and inner layout are not yet modeled, so the decoder captures
//     this zone verbatim as a single `preTextBytes` Buffer.
//   - Text zone (~62 KB) holds 104 per-region records. Each record opens with
//     a pstr16-ish header [u16 lenP1][ASCIIZ region_name] using region names
//     from descr_mercenaries.txt (achaea .. western_balkans). The body that
//     follows contains zero or more `merc <unit_name>` ASCIIZ entries (623
//     across all regions) plus per-slot binary state (count, weight, hash,
//     0xff-fill padding) and ends at the next region's pstr16 header. The
//     final region's body extends to the section's end byte (encompassing the
//     16-byte per-pool counter rows in the tail).
//
// Decoder strategy: walk forward from `start` byte-by-byte looking for a
// valid pstr16 region-name header. A header is recognized purely by shape —
// [u16 lenP1 in 5..32] + [(lenP1-1) bytes of [a-z_] ] + [NUL] — so the
// decoder requires no descr_mercenaries.txt lookup. Each region's body spans
// from its header to the next header (or to `end` for the last region). The
// pool-state pre-text zone (everything before the first header) is captured
// verbatim. Round-trip is byte-identical by construction: encoder writes
// preTextBytes, then for each region: [u16 lenP1][name bytes][NUL][body].

const MP_START = 0x14e5ac6;
const MP_END   = 0x1501615;

function decodeMercPoolTable(buf, start, end) {
  if (start !== MP_START || end !== MP_END) {
    throw new Error(`decodeMercPoolTable: unexpected range [0x${start.toString(16)}..0x${end.toString(16)}); expected [0x${MP_START.toString(16)}..0x${MP_END.toString(16)})`);
  }
  // Walk forward, recognizing pstr16 region-name headers by shape.
  const headers = [];
  let p = start;
  while (p + 2 < end) {
    const lenP1 = buf.readUInt16LE(p);
    if (lenP1 < 5 || lenP1 > 32 || p + 2 + lenP1 > end) { p++; continue; }
    let ok = true;
    for (let j = 0; j < lenP1 - 1; j++) {
      const c = buf[p + 2 + j];
      if (!((c >= 0x61 && c <= 0x7a) || c === 0x5f)) { ok = false; break; }
    }
    if (!ok || buf[p + 2 + lenP1 - 1] !== 0) { p++; continue; }
    const name = buf.slice(p + 2, p + 2 + lenP1 - 1).toString("latin1");
    headers.push({ off: p, name, lenP1 });
    p += 2 + lenP1;                     // skip past header
  }
  if (headers.length === 0) throw new Error("decodeMercPoolTable: no region headers found");

  const preTextBytes = Buffer.from(buf.slice(start, headers[0].off));
  const regions = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const bodyStart = h.off + 2 + h.lenP1;
    const recEnd = (i + 1 < headers.length) ? headers[i + 1].off : end;
    regions.push({
      name: h.name,
      body: Buffer.from(buf.slice(bodyStart, recEnd)),
    });
  }
  return { _kind: "merc-pool-table", preTextBytes, regions };
}

function encodeMercPoolTable(m) {
  if (m._kind !== "merc-pool-table") throw new Error("encodeMercPoolTable: not a merc-pool-table object");
  const chunks = [m.preTextBytes];
  for (const r of m.regions) {
    const nameBuf = Buffer.from(r.name, "latin1");
    const lenP1 = nameBuf.length + 1;
    const hdr = Buffer.alloc(2 + lenP1);
    hdr.writeUInt16LE(lenP1, 0);
    nameBuf.copy(hdr, 2);
    hdr[2 + nameBuf.length] = 0;
    chunks.push(hdr, r.body);
  }
  return Buffer.concat(chunks);
}

const SERIALIZERS = {
  // Real decode/encode pairs.
  "Header":                  (buf, start, end) => encodeHeader(decodeHeader(buf, start, end)),
  "HST":                     (buf, start, end) => encodeHST(decodeHST(buf, start, end)),
  "Toggle_fow/RNG counter":  (buf, start, end) => encodeFowCounterBlock(decodeFowCounterBlock(buf, start, end)),
  "character-paths":         (buf, start, end) => encodeCharacterPaths(decodeCharacterPaths(buf, start, end)),
  "tile-grid-matrix":        (buf, start, end) => encodeTileGridMatrix(decodeTileGridMatrix(buf, start, end)),
  "ZoneB-scripted-events":   (buf, start, end) => encodeScriptedEvents(decodeScriptedEvents(buf, start, end)),
  "merc-pool-table":         (buf, start, end) => encodeMercPoolTable(decodeMercPoolTable(buf, start, end)),
  "post-fow-35-stride-table":(buf, start, end) => encodePostFowStrideTable(decodePostFowStrideTable(buf, start, end)),
  "diplo-event-log":         (buf, start, end) => encodeDiploEventLog(decodeDiploEventLog(buf, start, end)),
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
