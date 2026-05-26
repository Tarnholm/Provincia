"use strict";
const fs = require("fs");
const D = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const DS = new Set([0, 100, 200, 400, 600, 850, 1000]);
function counts(f, key) {
  const b = fs.readFileSync(D + f); const h = {}; let n = 0;
  for (let o = 0x4000; o + 8 <= b.length; o++) {
    if (b.readUInt32LE(o) !== 200) continue;
    const a = b.readUInt32LE(o + 4); if (!DS.has(a)) continue;
    if (b.readUInt32LE(o - 4) !== key) continue;
    h[a] = (h[a] || 0) + 1; n++;
  }
  return { n, h };
}
for (const f of ["save_macedon t0.sav", "save_Seleucids t0.sav",
                 "save_Autosave   Seleucid Empire   Turn 1.sav",
                 "save_Autosave   Antigonid Kingdom   Turn 1.sav",
                 "save_Autosave   Carthage   Turn 1 End.sav",
                 "save_Autosave   Republic of Rome   Turn 2.sav"]) {
  try { const c = counts(f, 10); console.log(`${f}\n   key=10 total=${c.n} hist=${JSON.stringify(c.h)} war600=${c.h[600]||0}`); }
  catch (e) { console.log(`${f}  (missing)`); }
}
