// Last attempt: search for exact byte patterns of (X,Y) and (Y,X) as 4-byte
// blocks. Also try X+Y as concat in different widths and as tile-index.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_1.3.sav"));

// X=398=0x018E (LE: 8E 01), Y=337=0x0151 (LE: 51 01)
// X=400=0x0190 (LE: 90 01), Y=335=0x014F (LE: 4F 01)

function findExact(buf, bytes, max = 64) {
  const out = []; let from = 0;
  while (out.length < max) {
    const i = buf.indexOf(bytes, from);
    if (i < 0) break;
    out.push(i); from = i + 1;
  }
  return out;
}

// Test 1: X then Y consecutive (4 bytes XY)
const aXY = Buffer.from([0x8e, 0x01, 0x51, 0x01]);
const bXY = Buffer.from([0x90, 0x01, 0x4f, 0x01]);
console.log(`pattern "X,Y" 4B  baseline: ${findExact(a, aXY).length}  save_1.3: ${findExact(b, bXY).length}`);

// Test 2: Y then X consecutive (4 bytes YX)
const aYX = Buffer.from([0x51, 0x01, 0x8e, 0x01]);
const bYX = Buffer.from([0x4f, 0x01, 0x90, 0x01]);
console.log(`pattern "Y,X" 4B  baseline: ${findExact(a, aYX).length}  save_1.3: ${findExact(b, bYX).length}`);

// Test 3: X with Y at offset +2 anywhere from 0 to 256
for (const dy of [4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128, 256]) {
  let aHits = 0, bHits = 0;
  for (let i = 0; i + 2 + dy + 2 <= a.length; i++) {
    if (a.readUInt16LE(i) === 398 && a.readUInt16LE(i + dy) === 337) aHits++;
  }
  for (let i = 0; i + 2 + dy + 2 <= b.length; i++) {
    if (b.readUInt16LE(i) === 400 && b.readUInt16LE(i + dy) === 335) bHits++;
  }
  console.log(`X@O Y@O+${dy}  baseline: ${aHits}  save_1.3: ${bHits}`);
}

// Test 4: Maybe X is actually at +2 and Y at 0 (Y first then X) with various deltas
console.log(`\nY first then X at +dx`);
for (const dx of [2, 4, 6, 8, 10, 12, 16]) {
  let aHits = 0, bHits = 0;
  for (let i = 0; i + 2 + dx + 2 <= a.length; i++) {
    if (a.readUInt16LE(i) === 337 && a.readUInt16LE(i + dx) === 398) aHits++;
  }
  for (let i = 0; i + 2 + dx + 2 <= b.length; i++) {
    if (b.readUInt16LE(i) === 335 && b.readUInt16LE(i + dx) === 400) bHits++;
  }
  console.log(`Y@O X@O+${dx}  baseline: ${aHits}  save_1.3: ${bHits}`);
}

// Test 5: Maybe coords are scaled. Azes UI=921,643 vs descr_strat=439,306 (ratio ~2.10).
// What if Leonidas's UI coords are ALSO descr_strat × 2.10? Then the user's reported
// (398, 337) is actually descr_strat-relative for Sparta, and the in-save value is ~836,707.
console.log(`\n[scaled coord hypothesis: original × 2.10]`);
for (const f of [2.0, 2.05, 2.10, 2.15]) {
  const sx = Math.round(398 * f);
  const sy = Math.round(337 * f);
  const sxV = Math.round(400 * f);
  const syV = Math.round(335 * f);
  let baseHits = 0, varHits = 0;
  for (let i = 0; i + 2 <= a.length; i++) if (a.readUInt16LE(i) === sx) baseHits++;
  for (let i = 0; i + 2 <= b.length; i++) if (b.readUInt16LE(i) === sxV) varHits++;
  console.log(`  scale=${f}: baseline X=${sx} hits=${baseHits}, save_1.3 X=${sxV} hits=${varHits}`);
}

// Test 6: Maybe the Y is encoded as (max_height - y). What's the map height?
// Rome Remastered Imperial Campaign is roughly 1024×512 (or larger). If max_h=1024,
// then Y_stored = 1024 - 337 = 687.
console.log(`\n[flipped-Y hypothesis (Y_stored = max_h - Y_ui)]`);
for (const maxH of [512, 700, 800, 1024, 1200, 1500, 2048, 4000]) {
  const sx = 398;
  const sy = maxH - 337;
  const sxV = 400;
  const syV = maxH - 335;
  let baseAt14 = 0;
  for (let i = 0; i + 2 + 14 + 2 <= a.length; i++) if (a.readUInt16LE(i) === sx && a.readUInt16LE(i + 14) === sy) baseAt14++;
  let varAt14 = 0;
  for (let i = 0; i + 2 + 14 + 2 <= b.length; i++) if (b.readUInt16LE(i) === sxV && b.readUInt16LE(i + 14) === syV) varAt14++;
  let baseAt2 = 0;
  for (let i = 0; i + 2 + 2 + 2 <= a.length; i++) if (a.readUInt16LE(i) === sx && a.readUInt16LE(i + 2) === sy) baseAt2++;
  let varAt2 = 0;
  for (let i = 0; i + 2 + 2 + 2 <= b.length; i++) if (b.readUInt16LE(i) === sxV && b.readUInt16LE(i + 2) === syV) varAt2++;
  if (baseAt14 || varAt14 || baseAt2 || varAt2)
    console.log(`  maxH=${maxH}: baseline X=${sx},Y=${sy} | dy14: base=${baseAt14},var=${varAt14}  dy2: base=${baseAt2},var=${varAt2}`);
}
