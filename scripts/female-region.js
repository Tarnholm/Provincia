// Decode the female/family-member table found around 0x1599c00.
// Walk the region, at each 4-byte position test if the u32 is a valid
// name-lookup index landing on a Capitalized name; print the hits with
// offset + delta so we can read off the record stride and field layout.
"use strict";
const fs = require("fs");
const MOD = "C:/RIS/RIS/data";
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav";
const lookup = fs.readFileSync(MOD + "/descr_names_lookup.txt", "utf8").replace(/^﻿/, "").split(/\r?\n/).map(s => s.trim());
const buf = fs.readFileSync(SAVE);

const START = parseInt(process.argv[3] || "0x1599a00");
const END   = parseInt(process.argv[4] || "0x159ab00");

// gender oracle from descr_strat: a name is female if it appears as a
// `female` character_record anywhere (rough — just to tag the dump).
const strat = fs.readFileSync(MOD + "/world/maps/campaign/imperial_campaign/descr_strat.txt","utf8");
const femNames=new Set(), maleNames=new Set();
for(const m of strat.matchAll(/^character(?:_record)?[, \t]+(?:sub_faction \w+,\s*)?([A-Z][A-Za-z]+)(?:\s+[A-Z][A-Za-z_]+)?,?\s*(?:named character[^,]*,\s*)?\b(male|female)\b/gm)){
  (m[2]==="female"?femNames:maleNames).add(m[1]);
}

console.log(`region 0x${START.toString(16)}..0x${END.toString(16)}  (${END-START} bytes)`);
let prev=null;
for (let o = START; o + 4 <= END; o++) {
  const v = buf.readUInt32LE(o);
  if (v < 50 || v >= lookup.length) continue;
  const nm = lookup[v];
  if (!nm || nm.length < 3 || !/^[A-Z][a-z]/.test(nm)) continue;
  const tag = femNames.has(nm) ? "F" : maleNames.has(nm) ? "M" : "?";
  const delta = prev==null ? 0 : o - prev;
  console.log(`@0x${o.toString(16)} +${delta.toString().padStart(4)}  idx=${String(v).padStart(4)} ${tag} ${nm}`);
  prev = o;
}
