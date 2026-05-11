// dig-trade6.js — find Uria's record extent and full byte map in rome6 vs rome7.
// Anchor: name UTF-16LE at tax+2272. But we suspect minor-faction settlement
// uses a different layout. Walk backward from name until we hit a recognizable
// boundary (zero run, 0xff filler, sentinel).
//
// Also: dump every byte that differs between rome6 and rome7 around Uria's name
// (range ±4KB).

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findSettlementByName(buf, name) {
  const nameU16 = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) nameU16.writeUInt16LE(name.charCodeAt(i), i * 2);
  const positions = [];
  let p = 0;
  while ((p = buf.indexOf(nameU16, p)) !== -1) {
    if (p >= 3) {
      const marker = buf.readUInt8(p - 3);
      const len = buf.readUInt16LE(p - 2);
      if (marker === 0x01 && len === name.length) {
        positions.push({ namePos: p, marker: p - 3 });
      }
    }
    p += 1;
  }
  return positions;
}

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));

// Find Uria name position in both
const uA = findSettlementByName(a, "Uria")[0];
const uB = findSettlementByName(b, "Uria")[0];
const bA = findSettlementByName(a, "Brundisium")[0];
const bB = findSettlementByName(b, "Brundisium")[0];

console.log(`Uria: rome6 name=0x${uA.namePos.toString(16)}, rome7 name=0x${uB.namePos.toString(16)}`);
console.log(`Brundisium: rome6 name=0x${bA.namePos.toString(16)}, rome7 name=0x${bB.namePos.toString(16)}`);

// Walk forward and backward from Uria's name in rome6 looking for record boundary
// (suspect: next "Brundisium" or other settlement name in same neighborhood)
function showRange(buf, label, startRel, endRel, anchor) {
  const start = anchor + startRel;
  const end = anchor + endRel;
  console.log(`\n## ${label}: ${anchor.toString(16)} ± [${startRel}..${endRel}]`);
  const slice = buf.slice(start, end);
  // print hex grouped by 16 bytes with relative offsets
  const hex = slice.toString("hex").match(/.{1,2}/g);
  for (let i = 0; i < hex.length; i += 16) {
    const rel = startRel + i;
    const hexstr = hex.slice(i, i + 16).join(" ");
    const ascii = Array.from(slice.slice(i, i + 16)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`  +${rel.toString().padStart(5)}: ${hexstr.padEnd(48)}  ${ascii}`);
  }
}

// Show Uria record bytes in rome6 and rome7. Walk -300..+300 from name position.
showRange(a, "Uria rome6 around name", -260, 200, uA.namePos);
showRange(b, "Uria rome7 around name", -260, 200, uB.namePos);

// Now compute the byte diff for Uria's record between rome6 and rome7.
console.log(`\n## byte diff (Uria's record area) rome6 vs rome7`);
const diffs = [];
for (let rel = -2400; rel <= 800; rel++) {
  const vA = a[uA.namePos + rel];
  const vB = b[uB.namePos + rel];
  if (vA !== vB) diffs.push({ rel, vA, vB });
}
console.log(`  ${diffs.length} byte diffs in [-2400..+800] around name`);
// Print first 40 diffs (grouped consecutive)
let lastRel = -10000;
for (const d of diffs.slice(0, 60)) {
  console.log(`  +${d.rel.toString().padStart(5)}  ${String(d.vA).padStart(3)}→${String(d.vB).padStart(3)}  ${d.rel === lastRel + 1 ? "(cont)" : ""}`);
  lastRel = d.rel;
}
