// Targeted female-record crack. Known Julii starting women (from descr_strat):
// Baebiana, Alypia, Dryantilla, Papiria, Prisca, Honoria, Cornelia, Marcia.
// Find each name's index in descr_names_lookup, search save_julii1 for that u32,
// and dump the byte context around each hit to reverse the female record layout.
"use strict";
const fs = require("fs");
const MOD = "C:/RIS/RIS/data";
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav";

const lookup = fs.readFileSync(MOD + "/descr_names_lookup.txt", "utf8").replace(/^﻿/, "").split(/\r?\n/).map(s => s.trim());
const idxOf = (name) => lookup.indexOf(name);

const FEMALES = ["Baebiana","Alypia","Dryantilla","Papiria","Prisca","Honoria","Cornelia","Marcia","Mucia"];
// a couple of known MALE family-record children as a contrast (for layout diff)
const MALES   = ["Baebianus","Dryantillus"]; // may not exist; we'll also try real ones below

const buf = fs.readFileSync(SAVE);
console.log(`save=${SAVE.split(/[\\/]/).pop()} size=${(buf.length/1e6).toFixed(1)}MB lookup=${lookup.length}`);

function findU32(val) {
  const out = [];
  const t = Buffer.alloc(4); t.writeUInt32LE(val >>> 0, 0);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { out.push(p); p += 1; }
  return out;
}

function ctx(off, before = 16, after = 40) {
  const s = Math.max(0, off - before), e = Math.min(buf.length, off + after);
  const hex = buf.slice(s, e).toString("hex").match(/../g).join(" ");
  return `@0x${off.toString(16)} [-${before}..+${after}]: ${hex}`;
}

for (const nm of FEMALES) {
  const idx = idxOf(nm);
  if (idx < 0) { console.log(`\n### ${nm}: NOT in lookup`); continue; }
  const hits = findU32(idx);
  console.log(`\n### ${nm}  idx=${idx}  hits=${hits.length}`);
  // Only show context if rare enough to be meaningful
  if (hits.length > 0 && hits.length <= 12) {
    for (const h of hits) console.log("   " + ctx(h));
  } else if (hits.length > 12) {
    console.log(`   (too many hits to dump; idx likely also a common value)`);
    // show first 3 anyway
    for (const h of hits.slice(0,3)) console.log("   " + ctx(h));
  }
}
