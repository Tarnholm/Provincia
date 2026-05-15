// dig-zeroff2.js — confirm the family signature and try an auto-detector.
//
// Signature (from dig-zeroff1):
//   - Run ends with `64 00 00 00 64 00 00 00 00 00 00 00 00 00 00 00 <u32 hash> ff ff ff ff`
//   - Body is >=39% zero, also has a fair amount of 0xff
//   - Often contains an embedded 8-byte selfPtr+u16 record near the end:
//     `<u32 ptr-to-self+0> <u32 ptr-to-self+4> <u16 small> ...`
//   - Often the start has `ff ff ff ff 00 00 00 ?? ?? ?? 01 00 00 00 00`
//   - HEAD CHARACTERISTIC: `02 00 00 00 ... ?? ?? 01 00 00 00 00 00 32 00 ...`
//     equiv to a faction subrecord header
//
// We'll scan ALL unclaimed runs in the army-trail extended zone, count how
// many end in the `ff ff ff ff` terminator with the `64 00 00 00 64` tail,
// and check what record sits just before them.

"use strict";

const fs = require("fs");
const path = require("path");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");

const { findCharacterRecords } = require(path.join(PROVINCIA_SRC, "characterParser.js"));
const { findUnitRecords }      = require(path.join(PROVINCIA_SRC, "unitParser.js"));
const { findAllSettlementMarkers, scanChainsBetween } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));
const { findFactionRecords }   = require(path.join(PROVINCIA_SRC, "factionRecordParser.js"));
const { findLuaCounters }      = require(path.join(PROVINCIA_SRC, "luaCounterParser.js"));

const buf = fs.readFileSync(SAVE);

// Build a coarse claimed-bitmap mirroring cover.js (without char-pool / army-trail).
const bm = new Uint8Array(buf.length);
function claim(s, e) {
  s = Math.max(0, s); e = Math.min(buf.length, e);
  for (let i = s; i < e; i++) bm[i] = 1;
}

// Same coverage shape as cover.js up through siege block. We'll skip char-pool-auto
// and army-trail-auto to leave their runs visible.
claim(0x0000, 0x3328);
claim(0x3328, 0x3bad);
claim(0x43f8, 0x44e2);
claim(0x44e2, 0x2a25d);
claim(0x2a25d, 0x2d155);
claim(0x2d4a9, 0x618f8);
claim(0x61c47, 0x846af);
claim(0x846af, 0xa8beb);
claim(0xa8beb, 0xf8fd2);
claim(0x14e5ac6, 0x1501615);

const GRID_START = 0xf8fd2;
const GRID_END   = GRID_START + 240 * 238 * 267;
claim(GRID_START, GRID_END);

claim(0x3bad, 0x3bad + 8);

const MOD_DATA_DIR = "C:/RIS/RIS/data";
let nameLookup = fs.readFileSync(path.join(MOD_DATA_DIR, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
let traitNames = [];
for (const line of fs.readFileSync(path.join(MOD_DATA_DIR, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
for (let i = 0; i < chars.length; i++) {
  const start = chars[i].offset - 47;
  const next  = i + 1 < chars.length ? chars[i + 1].offset - 47 : chars[i].offset + 800;
  const recEnd = Math.min(next, chars[i].offset + 800);
  claim(Math.max(0, start), recEnd);
}

const units = findUnitRecords(buf);
for (let i = 0; i < units.length; i++) {
  const start = units[i].offset - 24;
  const next  = i + 1 < units.length ? units[i + 1].offset - 24 : units[i].offset + 256;
  const recEnd = Math.min(next, units[i].offset + 256);
  claim(Math.max(0, start), recEnd);
}

const factions = findFactionRecords(buf);
for (const f of factions) claim(f.offset, f.offset + f.size);

const SETT_ZONE_START = 0xf85f00;
const SETT_ZONE_END   = 0x1f10c72;
const settsAll = findAllSettlementMarkers(buf);
const setts = settsAll.filter(s => s.offset >= SETT_ZONE_START && s.offset < SETT_ZONE_END);
for (const s of setts) claim(s.offset, s.blockEnd);
for (let i = 0; i < setts.length; i++) {
  const prevEnd = i === 0 ? SETT_ZONE_START : setts[i - 1].blockEnd;
  const chains = scanChainsBetween(buf, prevEnd, setts[i].offset, null, null);
  for (const c of chains) {
    const span = Math.min(c.size || 16, 4096);
    claim(c.offset, c.offset + span);
  }
}

// Settlement-detail (same code as cover.js)
const FC_MAGIC = Buffer.from([0xfc, 0xfc, 0xfc, 0xfc, 0x64, 0x00, 0x00, 0x00, 0x00]);
const TOK_DEF  = Buffer.from("default_set");
const TOK_HINT = Buffer.from("hinterland_region");
const TOK_CORE = Buffer.from("core_building");
for (let i = 0; i < setts.length; i++) {
  const rs = setts[i].blockEnd;
  const re = (i + 1 < setts.length) ? setts[i + 1].offset : SETT_ZONE_END;
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
  const score = (fcOk ? 1 : 0) + (defOk ? 1 : 0) + (hintOk ? 1 : 0) + (coreOk ? 1 : 0) + (termOk ? 1 : 0);
  if (score >= 3) claim(rs, re);
}

// Siege
if (0x152f529 + 73 <= buf.length) claim(0x152f529, 0x152f529 + 73);

// RLE shroud
const RLE_MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);
const rleOffsets = [];
let p = 0x1f48000;
while (p < buf.length - 8) {
  const i = buf.indexOf(RLE_MAGIC, p);
  if (i < 0) break;
  if (i >= 8 && buf.readUInt32LE(i - 8) === i - 8) rleOffsets.push(i - 8);
  p = i + 4;
}
for (let i = 0; i < rleOffsets.length; i++) {
  const start = rleOffsets[i] - 16;
  const end   = i + 1 < rleOffsets.length ? rleOffsets[i + 1] - 16 : rleOffsets[i] + 30_000;
  claim(Math.max(0, start), Math.min(buf.length, end));
}

// Lua counters
const counters = findLuaCounters(buf);
if (counters.length > 0) claim(counters[0].offset, counters[counters.length - 1].end);

// === Now reproduce char-pool-auto + army-trail-auto to mirror the actual cover.js bitmap ===
{
  const ZONE_START = 0x14e5ac6;
  const ZONE_END   = Math.min(0x1f10c72, buf.length);
  const MIN_GAP    = 5 * 1024;
  const PORTRAIT   = Buffer.from("data/ui/");
  let runStart = -1;
  const runs = [];
  for (let i = ZONE_START; i <= ZONE_END; i++) {
    const claimedHere = i < ZONE_END && bm[i];
    if (!claimedHere && runStart < 0) runStart = i;
    else if (claimedHere && runStart >= 0) {
      if (i - runStart >= MIN_GAP) runs.push([runStart, i]);
      runStart = -1;
    }
  }
  if (runStart >= 0 && ZONE_END - runStart >= MIN_GAP) runs.push([runStart, ZONE_END]);
  for (const [rs, re] of runs) {
    let tailOk = false;
    const searchEnd = Math.min(buf.length - 4, re + 100);
    for (let p2 = re; p2 < searchEnd; p2++) {
      if (buf[p2] !== 0xef) continue;
      for (let q = p2 + 1; q < Math.min(p2 + 22, buf.length - 4); q++) {
        if (buf[q] === 0x01 && buf[q + 1] === 0x00) {
          const len = buf.readUInt16LE(q + 2);
          if (len >= 3 && len <= 64 && q + 4 + len <= buf.length) {
            let ok = true;
            for (let k = 0; k < len; k++) {
              const c = buf[q + 4 + k];
              const isAlpha = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
              const isDigit = (c >= 0x30 && c <= 0x39);
              if (!isAlpha && !isDigit && c !== 0x5f && c !== 0x20 && c !== 0x2d) { ok = false; break; }
            }
            if (ok) { tailOk = true; break; }
          }
        }
      }
      if (tailOk) break;
    }
    let ffCount = 0;
    for (let i = rs; i < re; i++) if (buf[i] === 0xff) ffCount++;
    const ffOk = (ffCount / (re - rs)) > 0.5;
    let portraitHits = 0;
    let p2 = rs;
    while (p2 < re) {
      const i = buf.indexOf(PORTRAIT, p2);
      if (i < 0 || i >= re) break;
      portraitHits++; p2 = i + PORTRAIT.length;
      if (portraitHits >= 3) break;
    }
    const portraitOk = portraitHits >= 3;
    if (tailOk || ffOk || portraitOk) claim(rs, re);
  }
}
{
  const ZONE_START = 0x14e5ac6;
  const ZONE_END   = Math.min(0x1f1fc14, buf.length);
  const MIN_GAP    = 1024;
  const CHAIN_TOKENS = [Buffer.from("_Town"), Buffer.from("_City"), Buffer.from("_Village"), Buffer.from("Hillfort"), Buffer.from("Stockade")];
  let runStart = -1;
  const runs = [];
  for (let i = ZONE_START; i <= ZONE_END; i++) {
    const claimedHere = i < ZONE_END && bm[i];
    if (!claimedHere && runStart < 0) runStart = i;
    else if (claimedHere && runStart >= 0) {
      if (i - runStart >= MIN_GAP) runs.push([runStart, i]);
      runStart = -1;
    }
  }
  if (runStart >= 0 && ZONE_END - runStart >= MIN_GAP) runs.push([runStart, ZONE_END]);
  for (const [rs, re] of runs) {
    let unitTailOk = false;
    const lookback = Math.max(0, rs - 320);
    for (let p2 = lookback; p2 < rs - 4; p2++) {
      const len = buf.readUInt16LE(p2);
      if (len < 4 || len > 48) continue;
      if (p2 + 2 + len > rs) continue;
      let ok = true;
      for (let k = 0; k < len; k++) {
        const c = buf[p2 + 2 + k];
        const isAlpha = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
        const isDigit = (c >= 0x30 && c <= 0x39);
        if (!isAlpha && !isDigit && c !== 0x20 && c !== 0x5f && c !== 0x2d) { ok = false; break; }
      }
      if (!ok) continue;
      unitTailOk = true; break;
    }
    let tileHits = 0;
    const winEnd2 = Math.min(re - 9, rs + 2048);
    for (let i = rs; i < winEnd2; i++) {
      if (buf[i] === 0) continue;
      const hi = buf[i + 1];
      if (hi < 0x0d || hi > 0x17) continue;
      let zeros = 0;
      for (let k = 2; k < 9; k++) if (buf[i + k] === 0) zeros++;
      if (zeros >= 5) tileHits++;
    }
    const winLen = winEnd2 - rs;
    const strideOk = winLen >= 256 && tileHits / winLen >= 0.06;
    let tokenOk = false;
    for (const t of CHAIN_TOKENS) {
      const i = buf.indexOf(t, rs);
      if (i >= 0 && i < re) { tokenOk = true; break; }
    }
    let termOk = false;
    const termStart = Math.max(rs, re - 96);
    for (let p2 = termStart; p2 + 20 < re; p2++) {
      if (buf[p2] === 0x1e && buf[p2+1] === 0 && buf[p2+2] === 0 && buf[p2+3] === 0) {
        let z = 0;
        for (let k = 4; k < 20 && p2 + k < re; k++) if (buf[p2 + k] === 0) z++;
        if (z >= 14) { termOk = true; break; }
      }
    }
    const portraitIdx = buf.indexOf(Buffer.from("data/ui/"), rs);
    const portraitOk = portraitIdx >= 0 && portraitIdx < re;
    if (unitTailOk || strideOk || tokenOk || termOk || portraitOk) claim(rs, re);
  }
}

// Now find ALL remaining unclaimed runs in zone [0x14e5ac6 .. 0x1f1fc14)
// and check how many match the zero-ff family signature.

const ZONE_START = 0x14e5ac6;
const ZONE_END   = Math.min(0x1f1fc14, buf.length);
const MIN_RUN    = 100;

let runStart = -1;
const runs = [];
for (let i = ZONE_START; i <= ZONE_END; i++) {
  const claimedHere = i < ZONE_END && bm[i];
  if (!claimedHere && runStart < 0) runStart = i;
  else if (claimedHere && runStart >= 0) {
    if (i - runStart >= MIN_RUN) runs.push([runStart, i]);
    runStart = -1;
  }
}
if (runStart >= 0 && ZONE_END - runStart >= MIN_RUN) runs.push([runStart, ZONE_END]);

console.log(`Found ${runs.length} unclaimed runs in zone [0x${ZONE_START.toString(16)}..0x${ZONE_END.toString(16)})`);

// Tests for the zero-ff family
function endsWithFFTerm(rs, re) {
  if (re - rs < 4) return false;
  return buf[re-4] === 0xff && buf[re-3] === 0xff && buf[re-2] === 0xff && buf[re-1] === 0xff;
}

function tail6464Pattern(rs, re) {
  // bytes pos: (re-26) 64 00 00 00 (re-22) 64 00 00 00 (re-18) 00 00 00 00 00 00 00 00 00 00 (re-8) hash hash hash hash (re-4) ff ff ff ff
  if (re - rs < 26) return false;
  const p = re - 26;
  return buf[p] === 0x64 && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0 &&
         buf[p+4] === 0x64 && buf[p+5] === 0 && buf[p+6] === 0 && buf[p+7] === 0 &&
         buf[p+8] === 0 && buf[p+9] === 0 && buf[p+10] === 0 && buf[p+11] === 0 &&
         buf[p+12] === 0 && buf[p+13] === 0 && buf[p+14] === 0 && buf[p+15] === 0 &&
         buf[p+16] === 0 && buf[p+17] === 0 &&
         buf[re-4] === 0xff && buf[re-3] === 0xff && buf[re-2] === 0xff && buf[re-1] === 0xff;
}

let n_ffTerm = 0, n_tail6464 = 0, n_bigEnough = 0;
const matchingRuns = [];
const nonMatch = [];

for (const [rs, re] of runs) {
  const big = re - rs >= 200;
  if (big) n_bigEnough++;
  const a = endsWithFFTerm(rs, re);
  const b = tail6464Pattern(rs, re);
  if (a) n_ffTerm++;
  if (b) n_tail6464++;
  if (big && b) matchingRuns.push([rs, re]);
  else if (big && !b) nonMatch.push([rs, re]);
}

console.log(`runs >= 200 B: ${n_bigEnough}`);
console.log(`runs ending in ff ff ff ff: ${n_ffTerm}`);
console.log(`runs with full tail-6464 signature: ${n_tail6464}`);
console.log(`matching big runs: ${matchingRuns.length}`);
console.log(`non-matching big runs: ${nonMatch.length}`);

// Total bytes covered by matching runs
let matchBytes = 0;
for (const [rs, re] of matchingRuns) matchBytes += re - rs;
console.log(`matching bytes (potential new claim): ${matchBytes}`);

// What sits just before matching runs?
console.log("\n--- 30 matching runs sample (sorted by size desc) ---");
matchingRuns.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
for (const [rs, re] of matchingRuns.slice(0, 30)) {
  // 16 B before
  const pre = Array.from(buf.slice(Math.max(0, rs - 16), rs)).map(x => x.toString(16).padStart(2, "0")).join(" ");
  console.log(`  [0x${rs.toString(16).padStart(8, "0")}..0x${re.toString(16).padStart(8, "0")}) size=${re - rs}  pre16=${pre}`);
}

console.log("\n--- 10 non-matching big runs sample ---");
nonMatch.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
for (const [rs, re] of nonMatch.slice(0, 10)) {
  const tail = Array.from(buf.slice(re - 32, re)).map(x => x.toString(16).padStart(2, "0")).join(" ");
  console.log(`  [0x${rs.toString(16).padStart(8, "0")}..0x${re.toString(16).padStart(8, "0")}) size=${re - rs}  tail32=${tail}`);
}
