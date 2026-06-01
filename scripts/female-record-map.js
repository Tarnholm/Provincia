// Map the family-member record layout. Given several known name offsets,
// dump each record as u32 columns relative to the name position so constant
// (structural) fields vs varying (name/age/uuid) fields are obvious.
"use strict";
const fs = require("fs");
const MOD = "C:/RIS/RIS/data";
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav";
const lookup = fs.readFileSync(MOD + "/descr_names_lookup.txt", "utf8").replace(/^﻿/, "").split(/\r?\n/).map(s => s.trim());
const buf = fs.readFileSync(SAVE);

// name offsets discovered (real family members)
const recs = [
  { nm: "Papiria", off: 0x1599cfb, g: "F" },
  { nm: "Prisca",  off: 0x1599e6b, g: "F" },
  { nm: "Honoria", off: 0x1599fdb, g: "F" },
  { nm: "GaiusB",  off: 0x159a147, g: "M" },
];
const PRE = 40, POST = 96; // bytes around name to inspect

// print as i32 at each 4-byte offset from name-4*K
for (const r of recs) {
  console.log(`\n=== ${r.nm} (${r.g}) name@0x${r.off.toString(16)} ===`);
  for (let d = -PRE; d <= POST; d += 4) {
    const o = r.off + d;
    if (o < 0 || o + 4 > buf.length) continue;
    const u = buf.readUInt32LE(o);
    const s = buf.readInt32LE(o);
    let note = "";
    if (u >= 50 && u < lookup.length && /^[A-Z][a-z]/.test(lookup[u]||"")) note = `name?=${lookup[u]}`;
    else if (s < 0 && s > -1000) note = `negSmall=${s}`;
    else if (u === 0xffffffff) note = "FFFF";
    else if (u < 256 && u > 0) note = `small=${u}`;
    console.log(`  +${String(d).padStart(4)}: ${String(u).padStart(11)}  0x${u.toString(16).padStart(8,"0")}  ${note}`);
  }
}
