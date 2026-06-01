// Locate wife records precisely via UUID linkage. A husband's spouseUuid ==
// his wife's primaryUuid, and primaryUuid sits at (recordStart - 47). So for
// each married general's spouseUuid S, every buffer occurrence of S at offset p
// is a candidate wife-record-start at p+47. Validate the body there (name, age,
// traits) WITHOUT a gender gate, and dump the wife's gender byte + fields.
"use strict";
const fs = require("fs");
const path = require("path");
const x = require("../src/saveCrackerExtras.js");
const MOD = "C:/RIS/RIS/data";
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const m of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+(\w+)/gm)) traitNames.push(m[1]);
const buf = fs.readFileSync(SAVE);
const validName = (i) => i >= 0 && i < nameLookup.length && nameLookup[i] && nameLookup[i].length >= 3 && nameLookup[i][0] >= "A" && nameLookup[i][0] <= "Z";

// body check at a candidate record start (both layouts), no gender gate
function recAt(i) {
  if (!validName(buf.readUInt32LE(i))) return null;
  for (const lb of [false, true]) {
    const pad9 = lb ? 5 : 9, ageOff = lb ? 22 : 26, tcOff = lb ? 298 : 302, tsOff = lb ? 304 : 308;
    if (i + tsOff + 8 > buf.length) continue;
    if (buf[i + pad9] !== 0) continue;
    if (lb && buf[i + 5] !== 0) continue;
    if (!lb) { const la = buf.readUInt32LE(i + 5); if (!(la >= 50 && validName(la))) continue; }
    const age = 242 - buf[i + ageOff];
    if (age < 0 || age > 100) continue;
    const tc = buf.readUInt16LE(i + tcOff);
    if (tc < 1 || tc > 200) continue;
    const tid0 = buf.readUInt32LE(i + tsOff);
    if (tid0 >= traitNames.length || !traitNames[tid0]) continue;
    return { layoutB: lb, name: nameLookup[buf.readUInt32LE(i)], gByte: buf[i + 4], age, tc,
             last: lb ? null : nameLookup[buf.readUInt32LE(i + 5)] };
  }
  return null;
}

const v2 = x.parseCharacterExtras(buf).filter(c => c.isMarried);
console.log(`married generals (v2): ${v2.length}`);
let wivesFound = 0; const samples = [];
const u32buf = Buffer.alloc(4);
for (const g of v2) {
  u32buf.writeUInt32LE(g.spouseUuid >>> 0, 0);
  let p = 0, foundForThis = false;
  while ((p = buf.indexOf(u32buf, p)) !== -1 && !foundForThis) {
    // scan a window of candidate record starts around the uuid occurrence
    for (let k = -60; k <= 240 && !foundForThis; k++) {
      const rec = recAt(p + k);
      if (rec) { wivesFound++; foundForThis = true; if (samples.length < 25) samples.push({ husbandUuid: g.ownUuid, off: p + k, k, ...rec }); }
    }
    p += 1;
  }
}
console.log(`wife records located at spouseUuid+47: ${wivesFound}/${v2.length}`);
console.log(`\ngByte distribution of located wives:`);
const d = {}; for (const s of samples) d[s.gByte] = (d[s.gByte]||0)+1;
console.log(" ", JSON.stringify(d), "(from first", samples.length, "samples)");
console.log(`\nsamples:`);
for (const s of samples) console.log(`  ${s.name}${s.last?(" "+s.last):""}  gByte=${s.gByte} age=${s.age} tc=${s.tc} layoutB=${s.layoutB} @0x${s.off.toString(16)}`);
