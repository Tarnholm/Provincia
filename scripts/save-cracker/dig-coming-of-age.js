// Find the bytes that got INSERTED when a Spartan son came of age between
// turn 4 end and turn 5 start. Largest insertion = the new character record.
import fs from "node:fs";
import path from "node:path";
import { diffSmart } from "./diff.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const t4 = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Sparta   Turn 4 End.sav"));
const t5 = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Sparta   Turn 5 Start.sav"));

console.log(`turn 4 end:   ${t4.length.toLocaleString()} bytes`);
console.log(`turn 5 start: ${t5.length.toLocaleString()} bytes`);
console.log(`size delta:   +${(t5.length - t4.length).toLocaleString()} bytes\n`);

console.log("computing shift-aware diff…");
const sm = diffSmart(t4, t5);
console.log(`${sm.runs.length} change-runs, ${sm.anchors.length} anchors`);

// Find runs where save_5 (b) is significantly larger than save_4 (a) — i.e.,
// genuine INSERTIONS (not just byte changes). lenB > lenA + N for some
// threshold means N+ bytes were inserted at this location.
const insertions = sm.runs
  .map(r => ({ ...r, lenA: r.aEnd - r.aStart, lenB: r.bEnd - r.bStart, growth: (r.bEnd - r.bStart) - (r.aEnd - r.aStart) }))
  .filter(r => r.growth >= 64) // only insertions of 64+ bytes
  .sort((a, b) => b.growth - a.growth);

console.log(`\n[top 30 byte-inserting runs (lenB > lenA by >= 64B)]`);
for (const r of insertions.slice(0, 30)) {
  console.log(`  @t4=0x${r.aStart.toString(16).padStart(8,"0")}  t5=0x${r.bStart.toString(16).padStart(8,"0")}  lenA=${r.lenA.toString().padStart(5)}  lenB=${r.lenB.toString().padStart(5)}  +${r.growth}B`);
}

// For the LARGEST insertion, dump the new bytes that exist in save_5 but not in save_4
const top = insertions[0];
if (top) {
  console.log(`\n[largest insertion (+${top.growth}B) — dumping save_5 bytes at 0x${top.bStart.toString(16)}..0x${top.bEnd.toString(16)}]`);
  const inserted = t5.subarray(top.bStart, top.bEnd);
  console.log(`  total length: ${inserted.length} bytes`);
  // Look for the character record signature: a u32 self-pointer
  // (taw invariant: u32 at X equals X) inside the inserted region
  const candidates = [];
  for (let i = 0; i + 8 <= inserted.length; i++) {
    const absInB = top.bStart + i;
    const ptrVal = inserted.readUInt32LE(i);
    if (ptrVal === absInB) {
      const size = inserted.readUInt32LE(i + 4);
      if (size >= 8 && size <= top.bEnd - absInB) {
        candidates.push({ inOff: i, absOff: absInB, size });
      }
    }
  }
  console.log(`  ${candidates.length} self-pointing sections inside the insertion`);
  for (const c of candidates.slice(0, 10)) {
    console.log(`    @0x${c.absOff.toString(16)}  size=${c.size}B`);
  }

  // Sample the first ~256 bytes of the insertion as ASCII hex
  console.log(`\n[first 256 bytes of insertion]`);
  for (let row = 0; row < Math.min(256, inserted.length); row += 16) {
    const slice = inserted.subarray(row, row + 16);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`  +${row.toString().padStart(4)} (0x${(top.bStart+row).toString(16)})  ${hex}  ${ascii}`);
  }

  // Look for embedded ASCII strings (cstrings) in the insertion — likely
  // portrait paths or trait names
  console.log(`\n[ASCII cstrings in the insertion (length >= 4)]`);
  const found = new Set();
  for (let i = 0; i < inserted.length - 4; i++) {
    const start = i;
    let j = i;
    let str = "";
    while (j < inserted.length && inserted[j] >= 0x20 && inserted[j] <= 0x7e && inserted[j] !== 0) {
      str += String.fromCharCode(inserted[j]); j++;
    }
    if (j < inserted.length && inserted[j] === 0 && str.length >= 4) {
      if (!found.has(str)) {
        found.add(str);
        console.log(`  +${start.toString().padStart(5)}  "${str}"`);
        if (found.size >= 30) break;
      }
    }
    i = j; // skip the string we just read
  }
}
