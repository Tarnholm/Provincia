// dig-stride9xyz5.js — DEBUG: dump bytes preceding the first 5 string hits to
// see why walk-back finds 0 runs.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const EDU  = "C:/RIS/RIS/data/export_descr_unit.txt";

const Z0 = 0x14e5ac6, Z1 = 0x20e6e8e;
const buf = fs.readFileSync(SAVE);

const eduText = fs.readFileSync(EDU, "utf8");
const typeNames = new Set();
for (const l of eduText.split(/\r?\n/)) {
  const m = l.match(/^\s*type\s+(.+?)\s*$/i);
  if (m) typeNames.add(m[1].trim());
}

const stringHits = [];
let p = Z0;
while (p < Z1 - 2) {
  const slen = buf.readUInt16LE(p);
  if (slen >= 4 && slen <= 64 && p + 2 + slen <= Z1) {
    let ok = true;
    for (let i = 0; i < slen - 1; i++) {
      const c = buf[p+2+i];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (ok && buf[p+2+slen-1] === 0) {
      const s = buf.slice(p+2, p+2+slen-1).toString("ascii");
      if (typeNames.has(s)) {
        stringHits.push({ pos: p, str: s, end: p+2+slen });
        p += 2 + slen;
        continue;
      }
    }
  }
  p++;
}
console.log(`found ${stringHits.length} EDU type-name strings`);

// Show 50 bytes before each of the first 10 hits
for (const h of stringHits.slice(0, 10)) {
  console.log(`\n=== "${h.str}" at pos 0x${h.pos.toString(16)} ===`);
  const start = Math.max(0, h.pos - 80);
  const before = buf.slice(start, h.pos);
  let hex = "";
  for (let i = 0; i < before.length; i++) {
    if (i % 16 === 0 && i) hex += "\n  ";
    hex += before[i].toString(16).padStart(2,"0") + " ";
  }
  console.log("  before:\n  " + hex);
}
