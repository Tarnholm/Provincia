// dig-religion-locate-block.js
// Locate the religion data structure in the save relative to a settlement record.
// We KNOW (memory reference_settlement_stats_block): 583-byte stats block ENDS at
// the UTF-16 name. creator@-583, level@-571, PO@-435, income@-127, population@-35.
//
// Religion spread (53 beliefs) must live either:
//   (a) as a dense 53-byte array somewhere in/after the stats block, or
//   (b) as a sparse list of (belief_idx, percent) pairs, or
//   (c) 53 u32 / u16 values.
//
// Strategy: pick several settlements (display names), find their \x01-name markers,
// and dump the bytes from name-700 .. name+400. Look for runs of small ints (0..100)
// that could be percentages, and count how many are nonzero.

const fs = require("fs");
const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);
console.log("save size:", buf.length, "bytes");

// settlement name finder: marker \x01, then [nchars u8][0x00][utf16le name][0x00 0x00]
function findSettlement(name) {
  // build the byte pattern: 0x01 <len> 0x00 <utf16 name>
  const arr = [0x01, name.length, 0x00];
  for (const ch of name) { arr.push(ch.charCodeAt(0)); arr.push(0x00); }
  const pat = Buffer.from(arr);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(pat, p)) !== -1) { hits.push(p); p += 1; }
  return hits;
}

// Settlements with known DISTINCT expected dominant religions on the imperial map:
//   Pella (Macedon capital) -> macedonian/hellenic
//   Thessalonica -> macedonian
//   Athens -> greek/ionian (athens)
//   Sparta -> dorian
//   Rome -> italic
//   Carthage -> phoenician
//   Alexandria -> egyptian
//   Memphis -> egyptian
//   Tarsus -> cilician/anatolian
//   Sardis -> lydian
//   Antioch -> assyrian/greek (seleucid)
const SETTLES = (process.argv[2] ? process.argv[2].split(",") : ["Pella","Rome","Alexandria"]);

for (const name of SETTLES) {
  const hits = findSettlement(name);
  if (hits.length === 0) { console.log("\n" + name + ": NOT FOUND"); continue; }
  // pick the settlement marker that has a plausible stats block (creator/level/pop sane)
  let chosen = null;
  for (const namePos of hits.map(h => h + 1)) { // h+1 = nchars byte (the marker is at h)
    const lvlOff = namePos - 571;
    const popOff = namePos - 35;
    if (lvlOff < 0 || popOff + 4 > buf.length) continue;
    const lvl = buf.readUInt32LE(lvlOff);
    const pop = buf.readUInt32LE(popOff);
    if (lvl <= 5 && pop >= 100 && pop <= 100000) { chosen = { marker: namePos - 1, namePos, lvl, pop }; break; }
  }
  if (!chosen) { console.log("\n" + name + ": found " + hits.length + " markers but none with valid stats block");
    chosen = { marker: hits[0], namePos: hits[0]+1, lvl: -1, pop: -1 }; }
  const np = chosen.namePos;
  console.log("\n========== " + name + " marker@0x" + chosen.marker.toString(16) + " name@0x" + np.toString(16) + " level=" + chosen.lvl + " pop=" + chosen.pop + " ==========");

  // Dump name-600 .. name+200 as rows of 16 bytes with offsets relative to name.
  const start = np - 600, end = np + 200;
  for (let row = start; row < end; row += 16) {
    let hex = "", asc = "";
    for (let k = 0; k < 16; k++) {
      const o = row + k;
      const b = (o >= 0 && o < buf.length) ? buf[o] : 0;
      hex += b.toString(16).padStart(2, "0") + " ";
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
    }
    const rel = row - np;
    console.log((rel >= 0 ? "+" : "") + rel + "\t0x" + (row>>>0).toString(16) + "\t" + hex + " " + asc);
  }
}
