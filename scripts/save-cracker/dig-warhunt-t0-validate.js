// dig-warhunt-t0-validate.js
// Validate the attitude-record finding against turn-0 mod-file wars.
// In the Spain save, war = a `[base=200(u32)][attitude(u32 in DS set)]` record
// with attitude=600. Wars are symmetric => 2 records per war pair.
//
// 1) Locate the attitude array in the turn-0 RIS saves (macedon, seleucid).
// 2) Count att=600 records.
// 3) Compare to ground-truth: number of distinct war PAIRS x2.
//
// Ground-truth war pairs from faction_relationships_large.json (dedup A<->B).
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const REL = "C:/dev/Provincia/public/faction_relationships_large.json";

const rels = JSON.parse(fs.readFileSync(REL, "utf8"));
const warPairs = new Set();
for (const [f, arr] of Object.entries(rels)) {
  for (const r of arr) {
    if (r.kind !== "war") continue;
    const pair = [f, r.to].sort().join("|");
    warPairs.add(pair);
  }
}
console.log(`ground-truth distinct war PAIRS: ${warPairs.size} => expect ${warPairs.size * 2} att=600 records (symmetric)`);
console.log("pairs:", [...warPairs].join(", "));

const DS = new Set([0, 100, 200, 400, 600, 850, 1000]);
function scanArray(buf) {
  // Find every `[200][DS]` head in the diplomacy region. For RIS saves the
  // region differs; scan a generous window 0x4000..0x80000 (before the big
  // tile/settlement zones). Report histogram + bounds.
  const heads = [];
  for (let o = 0x4000; o + 8 <= Math.min(buf.length, 0x200000); o++) {
    if (buf.readUInt32LE(o) === 200 && DS.has(buf.readUInt32LE(o + 4))) {
      // require the preceding u32 to be a small key (record marker) to reduce noise
      heads.push({ o, att: buf.readUInt32LE(o + 4), key: o >= 4 ? buf.readUInt32LE(o - 4) : -1 });
    }
  }
  return heads;
}

for (const f of ["save_macedon t0.sav", "save_Seleucids t0.sav"]) {
  const buf = fs.readFileSync(SAVES_DIR + f);
  const heads = scanArray(buf);
  const hist = {};
  for (const h of heads) hist[h.att] = (hist[h.att] || 0) + 1;
  // Find contiguous cluster of these heads (the array)
  let first = heads.length ? heads[0].o : -1, last = heads.length ? heads[heads.length-1].o : -1;
  console.log(`\n${f}: ${heads.length} [200][DS] heads in 0x4000..0x200000`);
  console.log(`  histogram: ${JSON.stringify(hist)}`);
  console.log(`  bounds: 0x${first.toString(16)}..0x${last.toString(16)}`);
  console.log(`  att=600 count: ${hist[600] || 0}`);
}
