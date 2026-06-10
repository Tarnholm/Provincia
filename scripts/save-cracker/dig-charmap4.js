// Dig deeper into specific char diffs across save pairs.
// Focus on (1) finding the largest interior diffs to identify rich state fields
// (2) then for each suspect offset, look at the byte values and try interpret them.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8")
  .split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

const A = process.argv[2] || "save_rome6.sav";
const B = process.argv[3] || "save_rome7.sav";
const a = fs.readFileSync(path.join(SAVES, A));
const b = fs.readFileSync(path.join(SAVES, B));
const recsA = cp.findCharacterRecords(a, nameLookup, traitNames, null);
const recsB = cp.findCharacterRecords(b, nameLookup, traitNames, null);
function key(r) { return `${r.primaryUuid}|${r.firstName}|${r.lastName}`; }
const idxA = new Map();
for (const r of recsA) idxA.set(key(r), r);

// Histogram: count characters per (offset, valueA, valueB) combo
const offHisto = new Map(); // off -> count
for (const rb of recsB) {
  const ra = idxA.get(key(rb));
  if (!ra) continue;
  for (let d = -48; d < 600; d++) {
    if (a[ra.offset + d] !== b[rb.offset + d]) {
      offHisto.set(d, (offHisto.get(d) || 0) + 1);
    }
  }
}

// Print offsets sorted by count
const sorted = [...offHisto.entries()].sort((x,y) => y[1] - x[1]);
console.log(`# offset histogram across ${recsB.length} chars`);
for (const [off, count] of sorted.slice(0, 50)) {
  console.log(`  rel ${(off>=0?"+":"")}${off}  count=${count}`);
}

// For the 5 most common offsets, sample a few characters and print the change
console.log("\n# samples for top 8 offsets");
for (const [off, count] of sorted.slice(0, 8)) {
  console.log(`\n## offset rel ${(off>=0?"+":"")}${off} (${count} chars)`);
  let samples = 0;
  for (const rb of recsB) {
    const ra = idxA.get(key(rb));
    if (!ra) continue;
    const va = a[ra.offset + off];
    const vb = b[rb.offset + off];
    if (va !== vb) {
      const ageDiff = ra.age !== rb.age ? `AGED ${ra.age}->${rb.age}` : "";
      const tDiff = ra.traits.length !== rb.traits.length ? `TRAITS ${ra.traits.length}->${rb.traits.length}` : "";
      console.log(`  ${ra.firstName} ${ra.lastName||""}: A=0x${va.toString(16).padStart(2,"0")} B=0x${vb.toString(16).padStart(2,"0")}  ${ageDiff} ${tDiff}`);
      if (++samples >= 5) break;
    }
  }
}
