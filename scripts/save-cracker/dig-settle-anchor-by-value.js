// dig-settle-anchor-by-value.js
//
// Anchor the real settlement stats block by searching for a KNOWN value
// (population / income / PO) as a u32 near the settlement name marker, instead
// of trusting fixed dx offsets that may differ across save layouts.
//
// Usage: node dig-settle-anchor-by-value.js "<save>" <name> <knownPopValue>

"use strict";
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function loadSave(arg) {
  if (fs.existsSync(arg)) return fs.readFileSync(arg);
  const p = path.join(SAVES, arg); if (fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error("save not found: " + arg);
}
const buf = loadSave(process.argv[2]);
const name = process.argv[3];
const known = parseInt(process.argv[4], 10);

// Find all name marker occurrences (flag,nchars,00,UTF16,0000)
function findName(name) {
  const occ = [];
  for (const flag of [0x01, 0x00]) {
    const b = Buffer.alloc(3 + name.length * 2 + 2);
    b[0] = flag; b[1] = name.length; b[2] = 0;
    for (let i = 0; i < name.length; i++) { b[3 + i * 2] = name.charCodeAt(i); b[3 + i * 2 + 1] = 0; }
    let p = 0; while ((p = buf.indexOf(b, p)) !== -1) { occ.push({ marker: p, namePos: p + 3, flag }); p += 1; }
  }
  occ.sort((a, b) => a.marker - b.marker);
  return occ;
}

const occ = findName(name);
console.log(`name "${name}": ${occ.length} occurrence(s); searching for value ${known} as u32 in [-700,+50] around each name`);
for (const o of occ) {
  const hits = [];
  for (let dx = -800; dx <= 100; dx++) {
    const off = o.namePos + dx;
    if (off < 0 || off + 4 > buf.length) continue;
    if (buf.readUInt32LE(off) === known) hits.push(dx);
  }
  console.log(`  marker@${o.marker} namePos=${o.namePos} flag=${o.flag} : value ${known} at dx = [${hits.join(", ")}]`);
}
