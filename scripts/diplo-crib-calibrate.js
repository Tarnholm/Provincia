// Diplomacy matrix CRIB calibration v4 — dynamic locate + full alignment sweep.
// Maps each descr_strat section to its cell field offset, finding (transpose, C)
// that best reproduces the crib. On a clean replica save this should be ~100%.
"use strict";
const fs = require("fs");

const STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const SMF   = "C:/RIS/RIS/data/descr_sm_factions.txt";
const SAVE  = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav";
const STRIDE = 267, N = 239;

function parseSection(text, kw) {
  const re = new RegExp("^\\s*" + kw + "\\s+([a-z0-9_]+),?\\s+(-?\\d+)\\s+([a-z0-9_]+)", "i");
  const g = {};
  for (const raw of text.split(/\r?\n/)) { const m = raw.match(re); if (!m) continue;
    (g[m[1].toLowerCase()] ||= {})[m[3].toLowerCase()] = parseInt(m[2], 10); }
  return g;
}
const t = fs.readFileSync(STRAT, "utf8");
const cribs = {
  core_attitudes:        { g: parseSection(t, "core_attitudes"),        norm: v => (v === -10 ? 0 : v) },
  faction_relationships: { g: parseSection(t, "faction_relationships"), norm: v => v },
  faction_agression:     { g: parseSection(t, "faction_agression"),     norm: v => v },
};
const names = [];
for (const line of fs.readFileSync(SMF, "utf8").split(/\r?\n/)) { const m = line.match(/^\t"([a-z_0-9]+)":/); if (m) names.push(m[1].toLowerCase()); }
const buf = fs.readFileSync(SAVE);

function locate() {
  const lc = (o) => o>=0 && o+20<=buf.length && buf.readUInt32LE(o+8)===200 && buf.readUInt32LE(o+16)===2 && buf.readUInt32LE(o)===0;
  let best=null;
  for (let p=0x4000; p<Math.min(buf.length-STRIDE*4,0x800000); p++){ if(!lc(p))continue; let g=0; while(lc(p+g*STRIDE))g++; if(!best||g>best.run)best={cell0:p,run:g}; p+=g*STRIDE; }
  return best;
}
const { cell0, run } = locate();
console.log(`save=${SAVE.split(/[\\/]/).pop()}  matrix@0x${cell0.toString(16)} run=${run} stride=${STRIDE} N=${N}\n`);

const valAt = (i, fo) => { const o = cell0 + i * STRIDE + fo; return (o>=0 && o+4<=buf.length) ? buf.readInt32LE(o) : null; };
function score(fo, crib, transpose, C) {
  let match=0, tot=0;
  for (let r=0;r<N;r++) for (let c=0;c<N;c++){ if(r===c)continue;
    const from = transpose? names[c]:names[r], to = transpose? names[r]:names[c];
    let exp = crib.g[from] && crib.g[from][to]; if (exp==null) continue; exp = crib.norm(exp);
    const got = valAt(r*N+c+C, fo); if (got==null) continue; tot++; if (got===exp) match++; }
  return { match, tot, frac: tot? match/tot : 0 };
}

const FIELDS = [12, 20, 24];
for (const fo of FIELDS) {
  for (const [name, crib] of Object.entries(cribs)) {
    let b={frac:-1};
    for (const tr of [false,true]) for (let C=-4;C<=4;C++){ const s=score(fo,crib,tr,C); if(s.frac>b.frac) b={...s,tr,C}; }
    if (b.frac>=0.6) console.log(`+${String(fo).padStart(2)}  ${name.padEnd(22)} ${(b.frac*100).toFixed(2)}% (${b.match}/${b.tot}) transpose=${b.tr} C=${b.C}`);
  }
}
