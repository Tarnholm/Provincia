// dig-trade11.js — examine Uria's record body in rome6 vs rome7 at the +200..+700
// diff cluster zone, looking for any u32 array that could be a trade-partner list.
// Also check if Brundisium's record has a similar shift.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));

function findSettlementByName(buf, name) {
  const nameU16 = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) nameU16.writeUInt16LE(name.charCodeAt(i), i * 2);
  let p = 0;
  while ((p = buf.indexOf(nameU16, p)) !== -1) {
    if (p >= 3) {
      const marker = buf.readUInt8(p - 3);
      const len = buf.readUInt16LE(p - 2);
      if (marker === 0x01 && len === name.length) return p;
    }
    p += 1;
  }
  return -1;
}

const uA = findSettlementByName(a, "Uria");
const uB = findSettlementByName(b, "Uria");

// Look at +200..+300 (where 71 diffs cluster)
function showRange(buf, label, anchor, start, end) {
  console.log(`\n## ${label}: anchor=0x${anchor.toString(16)}, rel [${start}..${end}]`);
  const slice = buf.slice(anchor + start, anchor + end);
  const hex = slice.toString("hex").match(/.{1,2}/g);
  for (let i = 0; i < hex.length; i += 16) {
    const rel = start + i;
    const hexstr = hex.slice(i, i + 16).join(" ");
    const ascii = Array.from(slice.slice(i, i + 16)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`  +${rel.toString().padStart(5)}: ${hexstr.padEnd(48)}  ${ascii}`);
  }
}

showRange(a, "Uria rome6 +200..+340", uA, 200, 340);
showRange(b, "Uria rome7 +200..+340", uB, 200, 340);

// The "hinterland_roads" sub-record in rome7 is at +2771 from Uria's name.
// Let me see if there's actually a "hinterland_roads" header NEAR the Uria record
// in rome6 too, just absent its data.
const nameU16 = Buffer.from("hinterland_roads", "ascii");
const haA = a.indexOf(nameU16, uA - 200);
const haB = b.indexOf(nameU16, uB - 200);
console.log(`\nrome6 nearest hinterland_roads to Uria: 0x${haA.toString(16)}  (rel=${haA - uA})`);
console.log(`rome7 nearest hinterland_roads to Uria: 0x${haB.toString(16)}  (rel=${haB - uB})`);

// Show the bytes around the NEW hinterland_roads in rome7 (it's at +2771 from Uria's name)
showRange(b, "Uria rome7 hinterland_roads sub-record area", uB, 2700, 3000);

// Same area in rome6 — what's there?
showRange(a, "Uria rome6 same area", uA, 2700, 3000);
