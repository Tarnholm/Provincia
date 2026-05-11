// Find chars that DIDN'T change in trait count and look at their interior diffs
// to identify per-turn fields that aren't trait-related.
const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");
const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
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

const offHisto = new Map();
let nstable = 0;
for (const rb of recsB) {
  const ra = idxA.get(key(rb));
  if (!ra) continue;
  if (ra.traits.length !== rb.traits.length) continue; // skip changed
  nstable++;
  for (let d = -48; d < 600; d++) {
    if (a[ra.offset + d] !== b[rb.offset + d]) {
      offHisto.set(d, (offHisto.get(d) || 0) + 1);
    }
  }
}
console.log(`# ${nstable} chars with constant trait count`);
const sorted = [...offHisto.entries()].sort((x, y) => y[1] - x[1]);
for (const [off, count] of sorted.slice(0, 30)) {
  console.log(`  rel ${(off>=0?"+":"")}${off}  count=${count}  pct=${(100*count/nstable).toFixed(1)}%`);
}

// For top offsets, sample value transitions
console.log("\n# samples for top 8 offsets (constant trait count chars)");
for (const [off, count] of sorted.slice(0, 8)) {
  console.log(`\n## offset rel ${(off>=0?"+":"")}${off}`);
  let n = 0;
  for (const rb of recsB) {
    const ra = idxA.get(key(rb));
    if (!ra) continue;
    if (ra.traits.length !== rb.traits.length) continue;
    const va = a[ra.offset + off];
    const vb = b[rb.offset + off];
    if (va !== vb) {
      console.log(`  ${ra.firstName} ${ra.lastName||""}: A=0x${va.toString(16).padStart(2,"0")}(${va}) B=0x${vb.toString(16).padStart(2,"0")}(${vb})  ageA=${ra.age} ageB=${rb.age} layout=${ra.lastName?'A':'B'}`);
      if (++n >= 6) break;
    }
  }
}
