// dig-econ-count-compare.js
// Is FACTION_ECONOMICS count a FIELD count (constant across saves) or an INSTANCE
// count (varies with number of alive factions)? Read the registry count for
// several types across vanilla + RIS saves of different sizes.
const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

const SAVES = [
  "save_macedon t0.sav",
  "save_Seleucids t0.sav",
  "save_arretium pre retrained..sav",
  "save_arretium turn 4.sav",
  "save_17-05-2026   Spain   Turn 1.sav",
  "save_t0.sav",
  "save_Autosave   Republic of Rome   Turn 2.sav",
];

function readRegistry(buf) {
  // find start
  let p = 0x3000;
  while (p < 0x8000) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const ns = p + 4;
      if (buf[ns] >= 0x41 && buf[ns] <= 0x5a) {
        const end = buf.indexOf(0, ns);
        if (end !== -1 && end < ns + 60) {
          const name = buf.slice(ns, end).toString("latin1");
          if (/^[A-Z][A-Z_0-9]*$/.test(name)) break;
        }
      }
    }
    p++;
  }
  const types = [];
  while (true) {
    const count = buf.readUInt32LE(p);
    const ns = p + 4;
    const end = buf.indexOf(0, ns);
    if (end === -1 || end > ns + 60) break;
    const name = buf.slice(ns, end).toString("latin1");
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, name, count });
    p = end + 1;
  }
  return types;
}

const WATCH = ["WORLD_MAP","FACTION","FACTION_ECONOMICS","ECONOMICS_DATA","SETTLEMENT","CHARACTER_DB","ARMY","SIEGE","OFFICE","RESOURCE_HEADER","DIPLOMATIC_ATTITUDE"];
console.log("save".padEnd(46) + WATCH.map(w=>w.slice(0,9).padStart(10)).join(""));
for (const f of SAVES) {
  const full = path.join(BASE, f);
  if (!fs.existsSync(full)) { console.log(f.padEnd(46) + " MISSING"); continue; }
  const buf = fs.readFileSync(full);
  const types = readRegistry(buf);
  const map = new Map(types.map(t=>[t.name,t.count]));
  console.log((f.slice(0,44)).padEnd(46) + WATCH.map(w=> String(map.has(w)?map.get(w):"-").padStart(10)).join(""));
}
