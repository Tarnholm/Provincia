// dig-faction-trailing2.js — Decode the 8-byte diff between notdamaged and damaged saves.
// Each diff is a candidate for "unit health" or "soldier count".
//
// Health typically goes from 100 → 50 (50% damage).
// Soldier count from 28 → 22 (28-22=6 soldiers dead).
//
// Let me determine the position and structure of each diff.

const fs = require("fs");
const path = require("path");

const ALEX_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves";
const SAVE_NOT_DAMAGED = path.join(ALEX_DIR, "save_notdamagedturn1.sav");
const SAVE_DAMAGED = path.join(ALEX_DIR, "save_damagedturn1.sav");

const bufA = fs.readFileSync(SAVE_NOT_DAMAGED);
const bufB = fs.readFileSync(SAVE_DAMAGED);

const diffOffsets = [];
for (let i = 0; i < bufA.length; i++) {
  if (bufA[i] !== bufB[i]) diffOffsets.push(i);
}
console.log(`Diff offsets: ${diffOffsets.length}`);
diffOffsets.forEach((o, idx) => {
  console.log(`\n[${idx}] @0x${o.toString(16)}: A=0x${bufA[o].toString(16).padStart(2,"0")} (${bufA[o]}) → B=0x${bufB[o].toString(16).padStart(2,"0")} (${bufB[o]})`);
  // Print context: 32 bytes before, 32 bytes after.
  console.log(`  Context bufA:`);
  for (let r = -2; r < 2; r++) {
    const off = o - 16 + r * 16;
    if (off < 0) continue;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 32; j++) {
      const b = bufA[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    const mark = (off <= o && o < off + 32) ? `  <-- diff @+${o - off}` : "";
    console.log(`    0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}${mark}`);
  }
});

// Now: which of these diffs is in a known faction record vs character vs unit?
// Look at strings in vicinity. Also: search for "macedon" or "antigonid" string nearby.

function findNearbyStrings(buf, center, range = 512) {
  const start = Math.max(0, center - range);
  const end = Math.min(buf.length, center + range);
  const strings = [];
  let inStr = false;
  let strStart = -1;
  for (let p = start; p < end; p++) {
    const b = buf[p];
    const printable = (b >= 0x20 && b <= 0x7e);
    if (printable) {
      if (!inStr) { inStr = true; strStart = p; }
    } else {
      if (inStr) {
        if (p - strStart >= 5) {
          strings.push({ off: strStart, len: p - strStart, s: buf.slice(strStart, p).toString("ascii") });
        }
        inStr = false;
      }
    }
  }
  return strings;
}

console.log(`\n\n===== Strings near each diff (radius 512 bytes) =====`);
for (const o of diffOffsets) {
  const strs = findNearbyStrings(bufA, o, 512);
  console.log(`\nDiff @0x${o.toString(16)} nearby strings:`);
  for (const s of strs.slice(0, 8)) console.log(`  0x${s.off.toString(16)} (${s.off < o ? "-" : "+"}${Math.abs(s.off - o)}): ${JSON.stringify(s.s)}`);
}
