// Whole-file scan for v2 character records (u32=3 + u32=0 + valid firstNameIdx)
// in both turn 4 end and turn 5 start. Diff the sets — what's new in t5
// = the son who came of age.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const t4 = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Sparta   Turn 4 End.sav"));
const t5 = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Sparta   Turn 5 Start.sav"));

function findChars(buf) {
  const out = [];
  for (let i = 0; i + 16 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== 3) continue;
    if (buf.readUInt32LE(i + 4) !== 0) continue;
    const firstIdx = buf.readUInt32LE(i + 8);
    if (firstIdx < 50 || firstIdx >= 5000) continue;
    const lastFlag = buf[i + 12];
    if (lastFlag !== 0 && lastFlag !== 1) continue;
    const lastIdx = lastFlag === 1 ? buf.readUInt32LE(i + 13) : 0;
    out.push({ off: i, firstIdx, lastFlag, lastIdx });
  }
  return out;
}

console.log(`scanning t4…`);
const c4 = findChars(t4);
console.log(`  ${c4.length} character records in t4`);
console.log(`scanning t5…`);
const c5 = findChars(t5);
console.log(`  ${c5.length} character records in t5`);
console.log(`  delta: ${c5.length - c4.length}`);

// Find characters in t5 with (firstIdx, lastIdx) NOT in t4
const t4Pairs = new Set(c4.map(c => `${c.firstIdx}|${c.lastIdx}`));
const newChars = c5.filter(c => !t4Pairs.has(`${c.firstIdx}|${c.lastIdx}`));
console.log(`\nnew (firstIdx, lastIdx) pairs in t5 not in t4: ${newChars.length}`);
for (const c of newChars.slice(0, 20)) {
  console.log(`  @0x${c.off.toString(16)}  firstIdx=${c.firstIdx}  lastFlag=${c.lastFlag}  lastIdx=${c.lastIdx}`);
}

// And vice versa: chars that disappeared from t4
const t5Pairs = new Set(c5.map(c => `${c.firstIdx}|${c.lastIdx}`));
const goneChars = c4.filter(c => !t5Pairs.has(`${c.firstIdx}|${c.lastIdx}`));
console.log(`\ncharacters in t4 not in t5: ${goneChars.length}`);
for (const c of goneChars.slice(0, 5)) {
  console.log(`  @0x${c.off.toString(16)}  firstIdx=${c.firstIdx}  lastFlag=${c.lastFlag}  lastIdx=${c.lastIdx}`);
}

// For the first new char, dump 256 bytes around it
if (newChars.length > 0) {
  const c = newChars[0];
  console.log(`\n=== bytes around first new character record @0x${c.off.toString(16)} ===`);
  for (let row = -32; row < 256; row += 16) {
    const o = c.off + row;
    if (o < 0 || o + 16 > t5.length) continue;
    const slice = t5.subarray(o, o + 16);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    let mark = "";
    if (row === 0) mark = "  ← record start (type=3)";
    if (row === 8) mark = "  ← firstName idx";
    console.log(`  Δ${String(row).padStart(4)}  ${hex}  ${ascii}${mark}`);
  }
}
