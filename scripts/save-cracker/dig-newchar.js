// Look at the smaller +256B insertions around 0x1160000 — those clusters are
// likely the new character record (or family-tree updates) for the son who
// came of age.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const t4 = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Sparta   Turn 4 End.sav"));
const t5 = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Sparta   Turn 5 Start.sav"));

// Dump bytes from t5 in the cluster region 0x1162cbf .. 0x1164f09
const ranges = [
  { start: 0x1162cbf, end: 0x1162cbf + 282, label: "smallest 1162cbf" },
  { start: 0x1164b5d, end: 0x1164b5d + 646, label: "largest cluster 1164b5d (646B)" },
  { start: 0x1164417, end: 0x1164417 + 256, label: "pure-insertion 1164417" },
];

for (const r of ranges) {
  console.log(`\n=== ${r.label} — ${r.end - r.start} bytes from t5 ===`);
  for (let row = 0; row < r.end - r.start; row += 16) {
    const o = r.start + row;
    if (o + 16 > t5.length) break;
    const slice = t5.subarray(o, o + 16);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`  0x${o.toString(16)}  ${hex}  ${ascii}`);
    if (row > 240) { console.log(`  ...truncated at 256B`); break; }
  }
}

// Look for the pattern of the existing v2 character record format:
//   +0:  uint32 type marker = 3 (named character)
//   +4:  zeros
//   +8:  firstName index
//   +12: lastName flag (0/1)
// Scan the larger insertion for this signature
console.log(`\n[searching for v2 character record signature (u32=3, u32=0) in t5 large insertion 0x2275565..0x22f0fab]`);
const start = 0x2275565, end = 0x22f0fab;
const candidates = [];
for (let i = start; i + 16 < end; i++) {
  if (t5.readUInt32LE(i) === 3 && t5.readUInt32LE(i + 4) === 0) {
    const firstIdx = t5.readUInt32LE(i + 8);
    if (firstIdx >= 50 && firstIdx < 5000) {
      candidates.push({ off: i, firstIdx, lastFlag: t5[i + 12] });
    }
  }
}
console.log(`  ${candidates.length} candidate v2 character record headers in the insertion`);
for (const c of candidates.slice(0, 10)) {
  console.log(`    @0x${c.off.toString(16)}  firstNameIdx=${c.firstIdx}  hasLastName=${c.lastFlag}`);
}

// Also scan the small insertion cluster
const start2 = 0x1162000, end2 = 0x1166000;
const candidates2 = [];
for (let i = start2; i + 16 < end2; i++) {
  if (t5.readUInt32LE(i) === 3 && t5.readUInt32LE(i + 4) === 0) {
    const firstIdx = t5.readUInt32LE(i + 8);
    if (firstIdx >= 50 && firstIdx < 5000) {
      candidates2.push({ off: i, firstIdx, lastFlag: t5[i + 12] });
    }
  }
}
console.log(`\n[v2 character record headers in 0x1162000..0x1166000]`);
console.log(`  ${candidates2.length} candidates`);
for (const c of candidates2.slice(0, 10)) {
  console.log(`    @0x${c.off.toString(16)}  firstNameIdx=${c.firstIdx}  hasLastName=${c.lastFlag}`);
}

// Compare with same range in t4 — new chars should have appeared
const candidates2T4 = [];
for (let i = start2; i + 16 < end2; i++) {
  if (i >= t4.length) break;
  if (t4.readUInt32LE(i) === 3 && t4.readUInt32LE(i + 4) === 0) {
    const firstIdx = t4.readUInt32LE(i + 8);
    if (firstIdx >= 50 && firstIdx < 5000) {
      candidates2T4.push({ off: i, firstIdx, lastFlag: t4[i + 12] });
    }
  }
}
console.log(`\n[v2 character record headers in t4 same range (0x1162000..0x1166000)]`);
console.log(`  ${candidates2T4.length} candidates in t4`);
for (const c of candidates2T4.slice(0, 10)) {
  console.log(`    @0x${c.off.toString(16)}  firstNameIdx=${c.firstIdx}  hasLastName=${c.lastFlag}`);
}

// Find first-name indices in t5 that DON'T appear in t4 — those are the new characters
const t4FirstIdxs = new Set(candidates2T4.map(c => c.firstIdx));
const newChars = candidates2.filter(c => !t4FirstIdxs.has(c.firstIdx));
console.log(`\n[characters in t5 but NOT in t4 (new since coming-of-age): ${newChars.length}]`);
for (const c of newChars.slice(0, 5)) {
  console.log(`    @0x${c.off.toString(16)}  firstNameIdx=${c.firstIdx}  hasLastName=${c.lastFlag}`);
}
