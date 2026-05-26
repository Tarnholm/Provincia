// dig-warhunt-t0-precise.js
// Apply the precise diplomacy-record signature (key=13 at base-4, base=200,
// attitude in DS set) to the turn-0 RIS saves. Confirm:
//  (a) the structure exists,
//  (b) att=600 (war) record count is IDENTICAL across the two t0 saves (static
//      config => must match),
//  (c) the att histogram is sane.
// Also report the att=850/1000 (total/crazy war) counts since RIS may use those.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const DS = [0,100,200,400,600,850,1000];

function records(buf) {
  const recs = [];
  for (let o = 0x4000; o + 0x18 <= buf.length; o++) {
    if (buf.readUInt32LE(o) !== 200) continue;
    const att = buf.readUInt32LE(o + 4);
    if (!DS.includes(att)) continue;
    if (buf.readUInt32LE(o - 4) !== 13) continue;
    recs.push({ base: o, att });
  }
  return recs;
}

const out = {};
for (const f of ["save_macedon t0.sav", "save_Seleucids t0.sav",
                 "save_Autosave   Spain   Turn 4 Start.sav",
                 "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"]) {
  const buf = fs.readFileSync(SAVES_DIR + f);
  const recs = records(buf);
  const hist = {}; for (const r of recs) hist[r.att] = (hist[r.att]||0)+1;
  const bounds = recs.length ? `0x${recs[0].base.toString(16)}..0x${recs[recs.length-1].base.toString(16)}` : "-";
  console.log(`${f}\n  key=13 records: ${recs.length}  hist: ${JSON.stringify(hist)}  war(600+): ${(hist[600]||0)+(hist[850]||0)+(hist[1000]||0)}  bounds ${bounds}`);
  out[f] = hist;
}
