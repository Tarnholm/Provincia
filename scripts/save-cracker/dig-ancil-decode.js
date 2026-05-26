// dig-ancil-decode.js — research/diagnostic ONLY (no app code changes)
//
// Re-derived layout from the dumps (offsets are RELATIVE TO trEnd, where
// trEnd = recordStart + tsOff + tc*8 as the existing parser computes it):
//
//   AntigonosB (3 ancs): ... 03 00 | 4a 01 00 00  07 01 00 00  6c 01 00 00 | 33 00 'data/'
//                              ^trEnd-2: count=3? no -> see below
//   The byte sequence ending the trait list and starting ancillaries is:
//     [u16 ancCount] [u16 0] then ancCount x [u32 id] then [u16 portraitLen]
//   AntigonosB: trEnd-4 = "03 00" (count=3), trEnd-2 = "4a 01" (LOW half of
//   first id 0x0000014a=330=poet) -> i.e. count is at trEnd-4, and the FIRST
//   id u32 starts at trEnd-2. The 4-byte stride then lands ids at:
//     id[0] @ trEnd-2, id[1] @ trEnd+2, id[2] @ trEnd+6 ... and the portrait
//   length u16 is at trEnd-2 + ancCount*4.
//
// Bottom line: ancCount @ (trEnd-4) u16; ids @ (trEnd-2 + k*4) u32.
// This explains why the old parser (which read pairs starting AT trEnd as
// [u16 pad][u16 id]) dropped exactly the FIRST ancillary every time.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVE = "save_macedon t0.sav";
const STRAT = path.join(MOD, "world/maps/campaign/imperial_campaign/descr_strat.txt");

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
const ancNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_ancillaries.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/); if (m) ancNames.push(m[1]);
}

const stratLines = fs.readFileSync(STRAT, "utf8").split(/\r?\n/);
const gtByTile = new Map();
let curChar = null;
for (const raw of stratLines) {
  if (raw.trim().startsWith(";")) continue;
  const cm = raw.match(/^character,\s*(?:sub_faction\s+\S+,\s*)?([A-Za-z_]+),.*?\bx\s+(\d+),\s*y\s+(\d+)/);
  if (cm) { curChar = { name: cm[1], x: +cm[2], y: +cm[3], ancs: [] }; gtByTile.set(`${cm[2]},${cm[3]}`, curChar); continue; }
  const am = raw.match(/^\s*ancillaries\s+(.+)$/);
  if (am && curChar) curChar.ancs = am[1].split(",").map(s => s.trim()).filter(Boolean);
}

const buf = fs.readFileSync(path.join(SAVES, SAVE));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
const recByTile = new Map();
for (const r of recs) if (r.tileX != null) recByTile.set(`${r.tileX},${r.tileY}`, r);

// Decoder under test: count u16 @ trEnd-4, ids u32 @ (trEnd-2 + k*4).
function decodeAncillaries(buf, charOff, layoutA) {
  const tsOff = layoutA ? 308 : 304;
  const tcOff = layoutA ? 302 : 298;
  const tc = buf.readUInt16LE(charOff + tcOff);
  const trEnd = charOff + tsOff + tc * 8;
  const cntOff = trEnd - 4;
  if (cntOff < 0 || cntOff + 2 > buf.length) return null;
  const ancCount = buf.readUInt16LE(cntOff);
  if (ancCount > 16) return null;
  const ids = [];
  for (let k = 0; k < ancCount; k++) {
    const o = (trEnd - 2) + k * 4;
    if (o + 4 > buf.length) return null;
    ids.push(buf.readUInt32LE(o));
  }
  // Portrait length u16 should follow at trEnd-2 + ancCount*4
  const portLenOff = (trEnd - 2) + ancCount * 4;
  const portLen = buf.readUInt16LE(portLenOff);
  return { ancCount, ids, portLen, trEnd };
}

let total = 0, exact = 0, partial = 0, fail = 0, noRec = 0;
const fails = [];
for (const gt of gtByTile.values()) {
  if (!gt.ancs.length) continue;
  total++;
  const r = recByTile.get(`${gt.x},${gt.y}`);
  if (!r) { noRec++; continue; }
  const dec = decodeAncillaries(buf, r.offset, !!r.lastName);
  const got = dec ? dec.ids.map(id => ancNames[id] || `#${id}`) : [];
  const exp = gt.ancs;
  const exactMatch = got.length === exp.length && exp.every((n, i) => got[i] === n);
  const setMatch = exp.length === got.length && exp.every(n => got.includes(n));
  if (exactMatch) exact++;
  else if (setMatch) partial++;
  else { fail++; fails.push({ gt, got, dec }); }
}
console.log(`Decoder validation on save_macedon t0.sav (RIS):`);
console.log(`  gt_chars_with_ancs=${total}  ordered_exact=${exact}  set_exact=${partial}  FAIL=${fail}  no_record=${noRec}`);
console.log(`  (excluding no_record: ${exact + partial}/${total - noRec} = ${(((exact+partial)/(total-noRec))*100).toFixed(1)}% correct)\n`);
if (fails.length) {
  console.log("Failures:");
  for (const f of fails.slice(0, 40)) {
    console.log(`  ${f.gt.name.padEnd(16)} @${f.gt.x},${f.gt.y} exp=[${f.gt.ancs.join(", ")}] got=[${f.got.join(", ")}] ${f.dec ? "cnt="+f.dec.ancCount+" portLen="+f.dec.portLen : "(rejected)"}`);
  }
}
