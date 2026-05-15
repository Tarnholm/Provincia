// dig-aidiplocache4.js — check the actual unclaimed-run shape at T1-T5
// after the full cover.js run (sans army-trail-auto).
// Approach: re-implement cover.js's claim sequence WITHOUT the army-trail
// detector, then print the unclaimed-run boundaries around the 5 targets.

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const MOD_DATA_DIR = "C:/RIS/RIS/data";

const { findCharacterRecords } = require(path.join(PROVINCIA_SRC, "characterParser.js"));
const { findUnitRecords }      = require(path.join(PROVINCIA_SRC, "unitParser.js"));
const { findAllSettlementMarkers, scanChainsBetween } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));
const { findFactionRecords }   = require(path.join(PROVINCIA_SRC, "factionRecordParser.js"));
const { findLuaCounters }      = require(path.join(PROVINCIA_SRC, "luaCounterParser.js"));

const buf = fs.readFileSync(SAVE);
const size = buf.length;
const bm = new Uint8Array(size);
function claim(s, e) { s = Math.max(0,s); e = Math.min(size,e); for (let i = s; i < e; i++) bm[i] = 1; }

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
claim(0xf8fd2, 0xf8fd2 + 240*238*267);
claim(0x3bad, 0x3bad+8);

const nameLookup = fs.readFileSync(path.join(MOD_DATA_DIR, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s=>s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD_DATA_DIR, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}
const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
for (let i = 0; i < chars.length; i++) {
  const s = chars[i].offset - 47;
  const next = i+1 < chars.length ? chars[i+1].offset - 47 : chars[i].offset + 800;
  claim(Math.max(0, s), Math.min(next, chars[i].offset + 800));
}

const units = findUnitRecords(buf);
for (let i = 0; i < units.length; i++) {
  const s = units[i].offset - 24;
  const next = i+1 < units.length ? units[i+1].offset - 24 : units[i].offset + 256;
  claim(Math.max(0, s), Math.min(next, units[i].offset + 256));
}

const factions = findFactionRecords(buf);
for (const f of factions) claim(f.offset, f.offset + f.size);

const SETT_ZONE_START = 0xf85f00, SETT_ZONE_END = 0x1f10c72;
const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= SETT_ZONE_START && s.offset < SETT_ZONE_END);
for (const s of setts) claim(s.offset, s.blockEnd);
for (let i = 0; i < setts.length; i++) {
  const prevEnd = i === 0 ? SETT_ZONE_START : setts[i-1].blockEnd;
  for (const c of scanChainsBetween(buf, prevEnd, setts[i].offset, null, null)) {
    claim(c.offset, c.offset + Math.min(c.size || 16, 4096));
  }
}
if (0x152f529 + 73 <= size) claim(0x152f529, 0x152f529 + 73);

// RLE shrouds
{
  const m = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);
  const offs = [];
  let p = 0x1f48000;
  while (p < size - 8) {
    const i = buf.indexOf(m, p);
    if (i < 0) break;
    if (i >= 8 && buf.readUInt32LE(i-8) === i-8) offs.push(i-8);
    p = i+4;
  }
  for (let i = 0; i < offs.length; i++) {
    const s = offs[i] - 16;
    const e = i+1 < offs.length ? offs[i+1] - 16 : offs[i] + 30000;
    claim(Math.max(0,s), Math.min(size, e));
  }
}

const counters = findLuaCounters(buf);
if (counters.length > 0) claim(counters[0].offset, counters[counters.length-1].end);

// char-pool detector
{
  const ZS = 0x14e5ac6, ZE = Math.min(0x1f10c72, size), MIN = 5*1024;
  const PORTRAIT = Buffer.from("data/ui/");
  let rs = -1; const runs = [];
  for (let i = ZS; i <= ZE; i++) {
    const ch = i < ZE && bm[i];
    if (!ch && rs < 0) rs = i;
    else if (ch && rs >= 0) { if (i - rs >= MIN) runs.push([rs, i]); rs = -1; }
  }
  if (rs >= 0 && ZE - rs >= MIN) runs.push([rs, ZE]);
  for (const [s, e] of runs) {
    let tailOk = false;
    for (let p = e; p < Math.min(size-4, e+100); p++) {
      if (buf[p] !== 0xef) continue;
      for (let q = p+1; q < Math.min(p+22, size-4); q++) {
        if (buf[q] === 0x01 && buf[q+1] === 0x00) {
          const len = buf.readUInt16LE(q+2);
          if (len >= 3 && len <= 64 && q+4+len <= size) {
            let ok = true;
            for (let k = 0; k < len; k++) {
              const c = buf[q+4+k];
              const isAlpha = (c>=0x61&&c<=0x7a) || (c>=0x41&&c<=0x5a);
              const isDigit = (c>=0x30&&c<=0x39);
              if (!isAlpha && !isDigit && c!==0x5f && c!==0x20 && c!==0x2d) { ok = false; break; }
            }
            if (ok) { tailOk = true; break; }
          }
        }
      }
      if (tailOk) break;
    }
    let ffc = 0; for (let i = s; i < e; i++) if (buf[i]===0xff) ffc++;
    const ffOk = ffc/(e-s) > 0.50;
    let ph = 0, p = s;
    while (p < e) { const i = buf.indexOf(PORTRAIT, p); if (i<0||i>=e) break; ph++; p = i+8; if (ph>=3) break; }
    const portraitOk = ph >= 3;
    if (tailOk || ffOk || portraitOk) claim(s, e);
  }
}

// Now print: for each target, find the actual unclaimed run it lives in.
const TARGETS = [
  { start: 0x01f1a697, end: 0x01f1fc14, label: "T1" },
  { start: 0x018be452, end: 0x018c1c1d, label: "T2" },
  { start: 0x01d000d6, end: 0x01d0373b, label: "T3" },
  { start: 0x01cf5669, end: 0x01cf8cbb, label: "T4" },
  { start: 0x01a9372d, end: 0x01a96d0e, label: "T5" },
];

for (const t of TARGETS) {
  // Find unclaimed run containing t.start.
  let rs = t.start;
  while (rs > 0 && !bm[rs-1]) rs--;
  let re = t.start;
  while (re < size && !bm[re]) re++;
  const len = re - rs;
  // Test A with this rs.
  let unitTailOk = false, detail = "";
  for (let p = Math.max(0, rs - 320); p < rs - 4; p++) {
    const slen = buf.readUInt16LE(p);
    if (slen < 4 || slen > 48) continue;
    if (p + 2 + slen > rs) continue;
    let ok = true;
    for (let k = 0; k < slen; k++) {
      const c = buf[p+2+k];
      const isAlpha = (c>=0x61&&c<=0x7a) || (c>=0x41&&c<=0x5a);
      const isDigit = (c>=0x30&&c<=0x39);
      if (!isAlpha && !isDigit && c!==0x20 && c!==0x5f && c!==0x2d) { ok = false; break; }
    }
    if (!ok) continue;
    detail = `len=${slen} ascii="${buf.toString('ascii', p+2, p+2+slen)}" gap=${rs-(p+2+slen)}`;
    unitTailOk = true; break;
  }
  console.log(`${t.label}: expected ${t.start.toString(16)}..${t.end.toString(16)}; actual unclaimed [${rs.toString(16)}..${re.toString(16)}) len=${len}`);
  console.log(`  testA: ${unitTailOk ? 'YES' : 'no'}  ${detail}`);

  // Test B
  let hits = 0;
  const winEnd = Math.min(re - 9, rs + 2048);
  for (let i = rs; i < winEnd; i++) {
    if (buf[i] === 0) continue;
    const hi = buf[i+1];
    if (hi < 0x0d || hi > 0x17) continue;
    let zeros = 0;
    for (let k = 2; k < 9; k++) if (buf[i+k] === 0) zeros++;
    if (zeros >= 5) hits++;
  }
  const winLen = winEnd - rs;
  console.log(`  testB: ${hits}/${winLen} (${(hits/winLen*100).toFixed(2)}%) -> ${hits/winLen >= 0.06 && winLen >= 256 ? 'YES' : 'no'}`);
}
