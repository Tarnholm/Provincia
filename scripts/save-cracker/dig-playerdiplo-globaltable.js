// The relation-uuid is likely an object handle into a GLOBAL relation table.
// Each relation object should store the two partner faction ids. Find the
// region with the densest concentration of relation-uuids (as u32), which
// should be that table, then decode its stride and look for faction-id fields.
const fs = require("fs");
const {
  parseFactionTreasuries, identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder("C:\\RIS\\RIS\\data\\descr_sm_factions.txt");
const MARKER=0x39240005;

const path = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav";
const buf = fs.readFileSync(path);

// collect all relation uuids from all zones
const uuidSet = new Set();
const uuidCls = new Map();
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const count = buf.readUInt32LE(i + 4);
  if (count === 0 || count > 250) continue;
  const fid = buf[i - 53]; if (fid >= order.length) continue;
  for (let k = 0; k < count; k++) {
    const o = i + 8 + k*16; if (o+16 > buf.length) break;
    const u = buf.readUInt32LE(o);
    uuidSet.add(u); uuidCls.set(u, buf.readUInt32LE(o+4));
  }
}
console.log(`total distinct relation uuids: ${uuidSet.size}, range ${Math.min(...uuidSet)}-${Math.max(...uuidSet)}`);

// Slide a 4KB window across the file, count how many u32-aligned values are in uuidSet.
const WIN = 2048;
let best = []; // {start, hits}
for (let base = 0; base + WIN < buf.length; base += WIN) {
  let hits = 0;
  for (let o = base; o < base + WIN; o += 4) {
    if (uuidSet.has(buf.readUInt32LE(o))) hits++;
  }
  if (hits > 30) best.push({ base, hits });
}
best.sort((a,b)=>b.hits-a.hits);
console.log(`\ntop windows by relation-uuid density (hits per 2KB / 512 u32s):`);
for (const b of best.slice(0, 20)) console.log(`  0x${b.base.toString(16)}: ${b.hits} hits`);
