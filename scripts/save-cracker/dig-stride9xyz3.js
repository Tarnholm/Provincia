// dig-stride9xyz3.js — locate ptolemai/psiloi/etc literally in save, then look
// backward for the stride-9 record table that terminates with them.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const EDU  = "C:/RIS/RIS/data/export_descr_unit.txt";

const Z0 = 0x14e5ac6, Z1 = 0x20e6e8e;
const buf = fs.readFileSync(SAVE);

function findAll(needle, lo, hi) {
  const positions = [];
  const n = Buffer.from(needle);
  let p = lo;
  while (p < hi) {
    const idx = buf.indexOf(n, p);
    if (idx < 0 || idx >= hi) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

// Search for these strings WITHIN the AI zone
const probes = ["ptolemai","egyptian","psiloi","cilici","machai","celtic","barbarian","greek","roman","seleucid","carthag","numidian","gaul","german","thracian","scythian","spaniard","slave","peasant","skirmisher","pikemen","spearmen","hoplit","heavy","light","cavalry","phalanx","missile"];
for (const s of probes) {
  const all = findAll(s, Z0, Z1);
  if (all.length > 0) console.log(`"${s}": ${all.length} occurrences in AI zone, first=0x${all[0].toString(16)}`);
}

// Pick "ptolemai" and look at the bytes around the first 5 occurrences
console.log("\n--- ptolemai context dumps (32 bytes before, 32 after) ---");
const pps = findAll("ptolemai", Z0, Z1);
console.log(`${pps.length} ptolemai positions in zone`);
for (const p of pps.slice(0, 5)) {
  const before = buf.slice(Math.max(0,p-32), p);
  const at = buf.slice(p, p+32);
  console.log(`pos 0x${p.toString(16)}: before=${[...before].map(b=>b.toString(16).padStart(2,"0")).join(" ")}  AT=${[...at].map(b=>b.toString(16).padStart(2,"0")).join(" ")} (${at.toString("ascii").replace(/[^ -~]/g,".")})`);
}

// Look at the 8 bytes immediately before each ptolemai — is there a length prefix?
console.log("\n--- ptolemai length-prefix check (4-byte u32 immediately before) ---");
for (const p of pps.slice(0, 10)) {
  if (p < 4) continue;
  const u32 = buf.readUInt32LE(p - 4);
  const u16 = buf.readUInt16LE(p - 2);
  const before8 = buf.slice(p-8, p);
  console.log(`pos 0x${p.toString(16)}: u32@-4=${u32}  u16@-2=${u16}  before8=${[...before8].map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
}
