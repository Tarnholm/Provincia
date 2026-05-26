// Settle the trait/ancillary boundary conflict by examining bytes directly.
// For each character: read traitCount N; is slot[N-1] (the slot the parser's
// `i<traitCount-1` loop DROPS) a VALID trait? If yes for ~all -> the parser
// drops a real trait (fix loop). If the bytes at trEnd-4 look like an anc count
// instead -> the -1 is correct.
const fs = require("fs");
const cp = require("C:/dev/Provincia/src/characterParser.js");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const TRAITS = "C:/RIS/RIS/data/export_descr_character_traits.txt";
const NAMES = "C:/RIS/RIS/data/text/names.txt";

const traitNames = [];
for (const l of fs.readFileSync(TRAITS, "utf8").split(/\r?\n/)) { const m = l.match(/^Trait\s+(\S+)/); if (m) traitNames.push(m[1]); }
const nameLookup = [];
for (const l of fs.readFileSync(NAMES, "utf16le").split(/\r?\n/)) { const m = l.replace(/^﻿/, "").match(/^\{[^}]+\}(.+)$/); if (m) nameLookup.push(m[1].trim()); }
console.log(`traitNames=${traitNames.length} nameLookup=${nameLookup.length}`);

const buf = fs.readFileSync(SAVE);
const chars = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`chars parsed=${chars.length}`);

const okTrait = (id) => id >= 0 && id < traitNames.length && !!traitNames[id];
let lastValid = 0, lastInvalid = 0, examined = 0;
const samples = [];
for (const c of chars) {
  if (!c.traits || c.traits.length < 1) continue;
  // detect layout: tc == parsed traits.length + 1 AND slot[0].id == traits[0].id
  let picked = null;
  for (const [tcOff, tsOff, lb] of [[302, 308, false], [298, 304, true]]) {
    if (c.offset + tsOff + 8 > buf.length) continue;
    const tc = buf.readUInt16LE(c.offset + tcOff);
    const id0 = buf.readUInt32LE(c.offset + tsOff);
    if (id0 === c.traits[0].id && tc >= 1 && tc <= 64) { picked = { tc, tsOff, lb }; break; }
  }
  if (!picked) continue;
  examined++;
  const { tc, tsOff } = picked;
  const lastOff = c.offset + tsOff + (tc - 1) * 8;
  const lastId = buf.readUInt32LE(lastOff);
  const lastPts = buf.readUInt16LE(lastOff + 4);
  const lastPad = buf.readUInt16LE(lastOff + 6);
  const parsedLen = c.traits.length; // == tc-1 if parser dropped last
  if (okTrait(lastId)) lastValid++; else lastInvalid++;
  if (samples.length < 8) samples.push(`tc=${tc} parsedLen=${parsedLen} lastSlot{id=${lastId}${okTrait(lastId)?`(${traitNames[lastId]})`:"(INVALID)"} pts=${lastPts} pad=${lastPad}}`);
}
console.log(`\nexamined=${examined}`);
console.log(`last slot is a VALID trait: ${lastValid}/${examined} (${(100*lastValid/examined).toFixed(0)}%)`);
console.log(`last slot INVALID: ${lastInvalid}/${examined}`);
console.log(`\nsamples:`);
for (const s of samples) console.log("  " + s);
console.log(`\nVERDICT: ${lastValid/examined > 0.9 ? "TRAITS AGENT RIGHT — last slot is a real trait, parser loop drops it (fix to i<traitCount)" : lastInvalid/examined > 0.9 ? "ANCIL AGENT RIGHT — last slot is NOT a trait, keep i<traitCount-1" : "MIXED — needs more analysis"}`);
