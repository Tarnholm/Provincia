// dig-warhunt-ris-key.js
// Find the diplomacy attitude records in the RIS turn-0 saves. The vanilla key
// was 13 (at base-4). RIS likely uses a different key. Find all base=200/att=DS
// heads and histogram the value at base-4 to discover the RIS key, then dump a
// few att=600 records' context.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const DS = new Set([0,100,200,400,600,850,1000]);
const buf = fs.readFileSync(SAVES_DIR + (process.argv[2] || "save_macedon t0.sav"));

// Restrict to where the diplomacy block likely is. In Spain it was 0xcfec..0x194ae
// (before settlement strings). In RIS find it by clustering. First histogram the
// base-4 value for att=600 heads only.
const keyHistFor = (attWanted) => {
  const h = {};
  for (let o = 0x4000; o + 8 <= buf.length; o++) {
    if (buf.readUInt32LE(o) !== 200) continue;
    const att = buf.readUInt32LE(o + 4);
    if (att !== attWanted) continue;
    const key = buf.readUInt32LE(o - 4);
    h[key] = (h[key] || 0) + 1;
  }
  return h;
};
console.log("base-4 key histogram for att=600 heads:", JSON.stringify(keyHistFor(600)));
console.log("base-4 key histogram for att=200 heads (top):");
const h200 = keyHistFor(200);
const top = Object.entries(h200).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log("  " + top.map(([k,v])=>`${k}:${v}`).join("  "));

// Dump 3 att=600 records' full context for whatever the dominant key is.
let shown = 0;
for (let o = 0x4000; o + 0x20 <= buf.length && shown < 4; o++) {
  if (buf.readUInt32LE(o) !== 200) continue;
  if (buf.readUInt32LE(o + 4) !== 600) continue;
  console.log(`\natt=600 @base 0x${o.toString(16)}:`);
  for (let r = -0x10; r < 0x18; r += 16) {
    const off = o + r; const sl = buf.slice(off, off + 16);
    const u = []; for (let j = 0; j + 4 <= sl.length; j += 4) u.push(sl.readUInt32LE(j));
    console.log(`  0x${off.toString(16)}  [${u.join(",")}]`);
  }
  shown++;
}
