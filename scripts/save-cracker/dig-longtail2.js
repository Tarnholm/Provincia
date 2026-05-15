// dig-longtail2.js — verify the "settlement-detail record" family.
//
// Hypothesis (from dig-longtail1.js): every unclaimed run sandwiched between
// two settle markers is a settlement-detail record with the signature:
//   - somewhere in first 24 B: `fc fc fc fc 64 00 00 00 00` (the actual record
//     header, possibly preceded by UTF-16 settlement-name tail bytes)
//   - contains "default_set" + "hinterland_region" + "core_building" tokens
//   - ends with `... ef 00 00 00` (last 4 bytes of run)
//   - size typically 1-9 KB
//
// Verify: scan the WHOLE settlement zone, identify every unclaimed run
// between settle markers, count how many match each clue. Estimate the
// coverage gain if we auto-claim these.

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

const MOD_DATA_DIR = "C:/RIS/RIS/data";
const loadNameLookup = (d) => fs.readFileSync(path.join(d, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const loadTraitNames = (d) => {
  const out = [];
  for (const l of fs.readFileSync(path.join(d, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^Trait\s+(\S+)/);
    if (m) out.push(m[1]);
  }
  return out;
};

const buf = fs.readFileSync(SAVE);
const size = buf.length;
const bm = new Uint8Array(size);
const claim = (s, e) => {
  s = Math.max(0, s); e = Math.min(size, e);
  for (let i = s; i < e; i++) bm[i] = 1;
};

// Mirror cover.js coarse claims (same as dig-longtail1).
claim(0, 0x3328);
claim(0x3328, 0x3bad);
claim(0x3bad, 0x3bb5);
claim(0x43f8, 0x44e2);
claim(0x44e2, 0x2a25d);
claim(0x2a25d, 0x2d155);
claim(0x2d4a9, 0x618f8);
claim(0x61c47, 0x846af);
claim(0x846af, 0xa8beb);
claim(0xa8beb, 0xf8fd2);
claim(0xf8fd2, 0xf84632);

const names = loadNameLookup(MOD_DATA_DIR);
const traits = loadTraitNames(MOD_DATA_DIR);
for (const c of findCharacterRecords(buf, names, traits)) if (c.recordSize) claim(c.offset, c.offset + c.recordSize);
for (const u of findUnitRecords(buf)) claim(u.offset, u.endOffset || u.offset + (u.recordSize || 280));
const settles = findAllSettlementMarkers(buf);
for (const s of settles) claim(s.offset, s.offset + (s.markerLen || 13));
for (let i = 0; i < settles.length; i++) {
  const start = settles[i].offset + (settles[i].markerLen || 13);
  const end   = (i + 1 < settles.length) ? settles[i + 1].offset : 0xf84632;
  try {
    for (const c of scanChainsBetween(buf, start, end)) claim(c.offset, c.offset + (c.recordSize || 0));
  } catch (_) {}
}
for (const f of findFactionRecords(buf)) claim(f.offset, f.offset + (f.recordSize || 0));
for (const l of findLuaCounters(buf)) claim(l.offset, l.offset + (l.recordSize || 0));
claim(0x14e5ac6, 0x1501615);
claim(0x152f529, 0x152f572);
claim(0x20e8342 - 0x18a4, 0x20e8342); // lua-footer rough

// Settlement zone: where settle markers and chains live.
const ZONE_START = 0xf84632;
const ZONE_END = 0x14e5ac6;

// Enumerate unclaimed runs inside the zone.
const runs = [];
let rs = -1;
for (let i = ZONE_START; i <= ZONE_END; i++) {
  const c = i < ZONE_END && bm[i];
  if (!c && rs < 0) rs = i;
  else if (c && rs >= 0) { if (i - rs >= 100) runs.push({ start: rs, end: i, bytes: i - rs }); rs = -1; }
}
console.log(`zone unclaimed runs >=100B: ${runs.length}, total ${runs.reduce((a,r)=>a+r.bytes,0)} B`);

// Settlement detail family tests.
const FC_MAGIC = Buffer.from([0xfc, 0xfc, 0xfc, 0xfc, 0x64, 0x00, 0x00, 0x00, 0x00]);
const TOK_DEF = Buffer.from("default_set");
const TOK_HINT = Buffer.from("hinterland_region");
const TOK_CORE = Buffer.from("core_building");
const TERM = Buffer.from([0xef, 0x00, 0x00, 0x00]);

function scoreRun(r) {
  const { start, end } = r;
  // FC magic in first 64 B?
  const fcIdx = buf.indexOf(FC_MAGIC, start);
  const fcOk = fcIdx >= 0 && fcIdx < start + 64;
  const defIdx = buf.indexOf(TOK_DEF, start);
  const defOk = defIdx >= 0 && defIdx < Math.min(end, start + 256);
  const hintIdx = buf.indexOf(TOK_HINT, start);
  const hintOk = hintIdx >= 0 && hintIdx < Math.min(end, start + 512);
  const coreIdx = buf.indexOf(TOK_CORE, start);
  const coreOk = coreIdx >= 0 && coreIdx < Math.min(end, start + 1024);
  // terminator ef 00 00 00 in last 16 B
  let termOk = false;
  for (let p = Math.max(start, end - 16); p + 4 <= end; p++) {
    if (buf[p] === 0xef && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) { termOk = true; break; }
  }
  // adjacent settle markers (look 0 B before and after; we know cover claimed settle markers as 13 B).
  // simpler: look 0..32 B before start for a settle-marker byte sequence end (we already split by claim).
  return { fcOk, defOk, hintOk, coreOk, termOk };
}

let matchAll = 0, matchSome = 0, byCount = { fcOk:0, defOk:0, hintOk:0, coreOk:0, termOk:0 };
let matchedBytes = 0;
const failures = [];
for (const r of runs) {
  const sc = scoreRun(r);
  for (const k of Object.keys(sc)) if (sc[k]) byCount[k]++;
  const passed = sc.fcOk && sc.defOk && sc.hintOk && sc.coreOk && sc.termOk;
  const any = sc.fcOk || sc.defOk || sc.hintOk || sc.coreOk || sc.termOk;
  if (passed) { matchAll++; matchedBytes += r.bytes; }
  if (any) matchSome++;
  if (!passed) failures.push({ r, sc });
}

console.log(`\nFamily test results (all 5 clues required for full match):`);
console.log(`  matched all 5 : ${matchAll}/${runs.length}  (${matchedBytes} B)`);
console.log(`  matched any   : ${matchSome}/${runs.length}`);
console.log(`  per-clue hits :`);
for (const k of Object.keys(byCount)) console.log(`    ${k}: ${byCount[k]}/${runs.length}`);

// Sample failures
console.log(`\nFirst 5 NON-matching runs (size desc):`);
failures.sort((a,b) => b.r.bytes - a.r.bytes);
for (const f of failures.slice(0, 5)) {
  console.log(`  0x${f.r.start.toString(16)} .. 0x${f.r.end.toString(16)}  ${f.r.bytes} B  passes=${JSON.stringify(f.sc)}`);
  console.log(`    head: ${[...buf.subarray(f.r.start, f.r.start + 48)].map(x=>x.toString(16).padStart(2,"0")).join(" ")}`);
}

// Coverage projection.
const totalUnknown = 4581064; // from cover.js
console.log(`\nIf we claim all 5-clue matches: +${matchedBytes} B`);
console.log(`Current unknown: ${totalUnknown} B (13.27%)`);
console.log(`After claim    : ${totalUnknown - matchedBytes} B (${((totalUnknown - matchedBytes)/34524371*100).toFixed(2)}%)`);
console.log(`Projected coverage: ${((34524371 - (totalUnknown - matchedBytes))/34524371*100).toFixed(2)}%`);

// Try a looser test: just "fcOk && termOk" — these two alone may already be tight.
let mLoose = 0, bLoose = 0;
for (const r of runs) {
  const sc = scoreRun(r);
  if (sc.fcOk && sc.termOk) { mLoose++; bLoose += r.bytes; }
}
console.log(`\nLoose test (fcOk + termOk): ${mLoose}/${runs.length} runs  ${bLoose} B`);
let mDef = 0, bDef = 0;
for (const r of runs) {
  const sc = scoreRun(r);
  if (sc.fcOk && sc.defOk) { mDef++; bDef += r.bytes; }
}
console.log(`Test (fcOk + defOk): ${mDef}/${runs.length} runs  ${bDef} B`);
