// For the player's relation uuids, find ALL occurrences in the whole save.
// If each uuid appears in a global registry record alongside two faction ids,
// that record names both partners. Check a few war-class uuids.
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const path = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav";
const playerIdx = 7;
const MARKER = 0x39240005;
const buf = fs.readFileSync(path);
const recs = parseFactionTreasuries(buf);
const firstMajor = recs[0].offset;
let markerOff = -1;
for (let i = 0; i + 8 < firstMajor; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const cnt = buf.readUInt32LE(i + 4);
  if (cnt > 0 && cnt <= 250) { markerOff = i; break; }
}
const count = buf.readUInt32LE(markerOff + 4);
const wars = [], allies = [], ceasefires = [];
for (let k = 0; k < count; k++) {
  const o = markerOff + 8 + k * 16;
  const u = buf.readUInt32LE(o), c = buf.readUInt32LE(o + 4);
  if (c === 2) wars.push(u);
  else if (c === 4) allies.push(u);
  else if (c === 1) ceasefires.push(u);
}
console.log(`player diplo zone @0x${markerOff.toString(16)} count=${count}`);
console.log(`war uuids (${wars.length}): ${wars.join(",")}`);
console.log(`locked-ally uuids (${allies.length}): ${allies.join(",")}`);
console.log(`ceasefire uuids (${ceasefires.length}): ${ceasefires.join(",")}`);

function findAll(u32) {
  const t = Buffer.alloc(4); t.writeUInt32LE(u32);
  const offs = []; let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { offs.push(p); p += 1; }
  return offs;
}

// For first 3 war uuids, show every occurrence and 16 bytes context around it.
function hexline(off) {
  let h="";for(let j=-4;j<12;j++){const b=buf[off+j];h+=(j===0?"[":"")+b.toString(16).padStart(2,"0")+(j===3?"]":"")+" ";}
  return h;
}
for (const u of wars.slice(0, 4)) {
  const offs = findAll(u);
  console.log(`\nwar uuid ${u} (0x${u.toString(16)}): ${offs.length} occurrences (4-byte aligned to anything)`);
  for (const o of offs) {
    const region = o < firstMajor ? "PLAYER" : (o < recs[recs.length-1].offset+500000 ? "NPC-records" : "tail");
    console.log(`  @0x${o.toString(16)} [${region}]  prev=${buf.readUInt32LE(o-4)} next=${buf.readUInt32LE(o+4)} next2=${buf.readUInt32LE(o+8)}`);
  }
}
