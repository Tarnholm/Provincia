// dig-ancil-structure.js — research/diagnostic ONLY
// Confirm the structural constants of the ancillary block across ALL parsed
// characters (not just ground-truth ones). For each record, examine the
// trait-terminator region and the bytes around it to nail the canonical
// layout and prove the count-position rule.
//
// From dumps the recurring pattern right before the ancillary ids is:
//   [u32 ???][u32 = 0x000000d1][u16 ancCount][... ids as u32 ...][u16 portLen]
// The 0xd1 (=209) u32 sits at a FIXED distance before the count. Let's verify.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVE = "save_macedon t0.sav";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
const ancNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_ancillaries.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/); if (m) ancNames.push(m[1]);
}

const buf = fs.readFileSync(path.join(SAVES, SAVE));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// For each record with tc>=1, examine trEnd-4 (count) and verify ids resolve.
let withAnc = 0, zeroAnc = 0, badCount = 0, idAllResolve = 0;
let portLenOk = 0;
const distCounts = {}; // distance from count-slot to the preceding "d1 000000" marker, if any
const sample = [];
for (const r of recs) {
  const layoutA = !!r.lastName;
  const tsOff = layoutA ? 308 : 304;
  const tcOff = layoutA ? 302 : 298;
  const tc = buf.readUInt16LE(r.offset + tcOff);
  if (tc < 1) continue;
  const trEnd = r.offset + tsOff + tc * 8;
  if (trEnd - 4 < 0 || trEnd + 64 > buf.length) continue;
  const cnt = buf.readUInt16LE(trEnd - 4);
  if (cnt > 16) { badCount++; continue; }
  if (cnt === 0) { zeroAnc++; }
  else {
    withAnc++;
    const ids = [];
    let allOk = true;
    for (let k = 0; k < cnt; k++) {
      const id = buf.readUInt32LE((trEnd - 2) + k * 4);
      ids.push(id);
      if (id >= ancNames.length || !ancNames[id]) allOk = false;
    }
    if (allOk) idAllResolve++;
    // portrait length sanity (10..200)
    const portLen = buf.readUInt16LE((trEnd - 2) + cnt * 4);
    if (portLen > 10 && portLen < 200) portLenOk++;
    if (sample.length < 12 && allOk) sample.push({ name: `${r.firstName} ${r.lastName||""}`.trim(), cnt, ids, names: ids.map(i=>ancNames[i]) });
  }
}
console.log(`Across ${recs.length} parsed records (tc>=1):`);
console.log(`  records with ancCount>0: ${withAnc}`);
console.log(`    of those, ALL ids resolve to real ancillary names: ${idAllResolve} (${(idAllResolve/withAnc*100).toFixed(1)}%)`);
console.log(`    of those, portrait length u16 valid right after ids: ${portLenOk} (${(portLenOk/withAnc*100).toFixed(1)}%)`);
console.log(`  records with ancCount==0: ${zeroAnc}`);
console.log(`  records with count>16 (rejected/garbage): ${badCount}`);
console.log(`\nSample resolved ancillary lists:`);
for (const s of sample) console.log(`  ${s.name.padEnd(20)} cnt=${s.cnt} -> [${s.names.join(", ")}]`);
