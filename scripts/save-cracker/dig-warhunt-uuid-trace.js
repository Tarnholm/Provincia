// dig-warhunt-uuid-trace.js
// Trace a relationUuid through the whole file. The diplo zone stores it once;
// where ELSE does it appear? A relationship object that names both parties +
// stance would contain this uuid. For antigonid in the seleucid save, the
// att=4 (war-mood) entry uuids are candidate war relationships.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const save = process.argv[2] || "save_Seleucids t0.sav";
const buf = fs.readFileSync(SAVES_DIR + save);

// uuids to trace (passed as remaining args), default antigonid att=4 set
const uuids = process.argv.slice(3).map(Number);
const list = uuids.length ? uuids : [765, 768, 927, 784, 881, 855, 794];

function hexdump(start, len) {
  const lines = [];
  for (let r = 0; r < len; r += 16) {
    const o = start + r;
    if (o < 0 || o >= buf.length) continue;
    const slice = buf.slice(o, Math.min(o + 16, buf.length));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
    lines.push(`    0x${o.toString(16).padStart(8, "0")}  ${hex.padEnd(48)}  ${asc}`);
  }
  return lines.join("\n");
}

for (const u of list) {
  const tgt = Buffer.alloc(4); tgt.writeUInt32LE(u >>> 0);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(tgt, p)) !== -1) { hits.push(p); p += 1; if (hits.length > 50) break; }
  console.log(`\n===== uuid ${u} : ${hits.length} occurrences (showing up to 12) =====`);
  for (const h of hits.slice(0, 12)) {
    console.log(`  @0x${h.toString(16)}`);
    console.log(hexdump(h - 16, 48));
  }
}
