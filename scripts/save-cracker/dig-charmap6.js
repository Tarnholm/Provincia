// Diff WITHIN-RECORD bytes only, respecting variable record extent
// (post-trait portrait paths shift the end).
// Record body: -47 (primaryUuid) ... record_start ... +offset.traitsStart+8*tc... portraits ... end.
// We diff only within the trait block + headers; portraits are variable-length strings.
const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");
const MOD = "C:/RIS/RIS/data";
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
const ia = new Map();
for (const r of recsA) ia.set(key(r), r);

// Pre-record uuids (-47, -43) + body up to traitsStart (excludes variable trait+portrait region).
// LAYOUT_A: traitsStart=308. LAYOUT_B: traitsStart=304.
const offHisto = new Map();
let na = 0, nb = 0;
for (const rb of recsB) {
  const ra = ia.get(key(rb));
  if (!ra) continue;
  const traitsStart = rb.lastName ? 308 : 304;
  if (rb.lastName) na++; else nb++;
  for (let d = -47; d < traitsStart; d++) {
    if (a[ra.offset + d] !== b[rb.offset + d]) {
      offHisto.set(d, (offHisto.get(d) || 0) + 1);
    }
  }
}
const total = na + nb;
console.log(`# ${total} chars matched (LAYOUT_A=${na}, LAYOUT_B=${nb})`);
const sorted = [...offHisto.entries()].sort((x, y) => y[1] - x[1]);
console.log("# offsets that change in HEADER region (not trait block):");
for (const [off, count] of sorted.slice(0, 50)) {
  console.log(`  rel ${(off>=0?"+":"")}${off.toString().padStart(4)}  count=${count.toString().padStart(4)}  pct=${(100*count/total).toFixed(1)}%`);
}
