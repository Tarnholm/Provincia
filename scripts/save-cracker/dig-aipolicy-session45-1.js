// dig-aipolicy-session45-1.js — Session 45: pin per-faction AI policy state
// in faction-record trailing data (+56+ of +44=6 major records).
//
// Strategy:
//  1. Walk MAJOR faction records (signature: u32(+8)=100, u32(+12)=1, u32(+44)=6,
//     u32(+24)==pos+24, u32(+40)==pos+40).
//  2. Pick romans_julii at index 0 (player faction).
//  3. Bound the record by the next major record's start (or by walking forward
//     until the next class-100 signature).
//  4. Diff turn-1 (save_1.2) vs turn-2 start (Autosave RoR Turn 2 Start) — both
//     anchored on the SAME romans_julii record.
//  5. Look for u32 values that EQUAL another faction's record-position-index
//     (0..22 for major) OR a small int (0..32) that could be a faction id.
//  6. Look for groups of N u32 values where N == 23 (per-major-faction threat
//     score table).

const fs = require("fs");

const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const T1_PATH = `${ROME_DIR}/save_1.2.sav`;
const T2_PATH = `${ROME_DIR}/save_Autosave   Republic of Rome   Turn 2 Start.sav`;

const bufT1 = fs.readFileSync(T1_PATH);
const bufT2 = fs.readFileSync(T2_PATH);

console.log(`T1 (save_1.2.sav): ${bufT1.length} bytes`);
console.log(`T2 (T2 Start): ${bufT2.length} bytes`);

// Walk major faction records. Signature (per session 5/7 notes):
//   +8 = 100 (class tag), +12 = 1, +44 = 6 (major), +24 == pos+24, +40 == pos+40
function findMajorRecords(buf) {
  const out = [];
  const end = buf.length - 64;
  for (let p = 0; p < end; p += 4) {
    if (buf.readUInt32LE(p + 8) !== 100) continue;
    if (buf.readUInt32LE(p + 12) !== 1) continue;
    if (buf.readUInt32LE(p + 44) !== 6) continue;
    if (buf.readUInt32LE(p + 24) !== p + 24) continue;
    if (buf.readUInt32LE(p + 40) !== p + 40) continue;
    out.push(p);
  }
  return out;
}

const majorsT1 = findMajorRecords(bufT1);
const majorsT2 = findMajorRecords(bufT2);
console.log(`T1 major faction records: ${majorsT1.length}`);
console.log(`T2 major faction records: ${majorsT2.length}`);
console.log(`T1 first 5 offsets: ${majorsT1.slice(0, 5).map(p => "0x" + p.toString(16)).join(", ")}`);
console.log(`T2 first 5 offsets: ${majorsT2.slice(0, 5).map(p => "0x" + p.toString(16)).join(", ")}`);

// Inspect record 0 (player = romans_julii in RoR).
// Treasury is at +0 (i32); verify what's there.
const r0T1 = majorsT1[0];
const r0T2 = majorsT2[0];
console.log(`\nRecord 0 in T1 at 0x${r0T1.toString(16)}: treasury=${bufT1.readInt32LE(r0T1)}`);
console.log(`Record 0 in T2 at 0x${r0T2.toString(16)}: treasury=${bufT2.readInt32LE(r0T2)}`);

// Length of record 0: from r0 to r1 (next major).
const lenT1 = majorsT1[1] - r0T1;
const lenT2 = majorsT2[1] - r0T2;
console.log(`Record 0 length T1: ${lenT1} bytes`);
console.log(`Record 0 length T2: ${lenT2} bytes`);

// Diff record 0 region between T1 and T2.
// Compare byte-by-byte at the SAME relative offset within record 0.
const minLen = Math.min(lenT1, lenT2);
const diffs = [];
for (let i = 0; i < minLen; i++) {
  if (bufT1[r0T1 + i] !== bufT2[r0T2 + i]) diffs.push(i);
}
console.log(`\nRecord-0 byte diffs (T1 vs T2): ${diffs.length} bytes`);

// Group consecutive diffs.
const groups = [];
let cur = null;
for (const d of diffs) {
  if (cur && d === cur.end + 1) {
    cur.end = d;
  } else {
    if (cur) groups.push(cur);
    cur = { start: d, end: d };
  }
}
if (cur) groups.push(cur);
console.log(`Diff groups: ${groups.length}`);
for (const g of groups.slice(0, 50)) {
  const size = g.end - g.start + 1;
  console.log(`  rel +${g.start} (+${g.start.toString(16)}h) .. +${g.end} (size=${size})`);
}

// Now print the trailing region (+56 .. +200) for context in both saves.
console.log(`\n===== T1 record 0 trailing bytes (+0 .. +256) =====`);
function dumpRel(buf, base, start, end) {
  for (let off = start; off < end; off += 16) {
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16 && off + j < end; j++) {
      const b = buf[base + off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`  +${off.toString().padStart(4, "0")}: ${hex.join(" ").padEnd(48)}  ${ascii.join("")}`);
  }
}
dumpRel(bufT1, r0T1, 0, 256);

console.log(`\n===== T2 record 0 trailing bytes (+0 .. +256) =====`);
dumpRel(bufT2, r0T2, 0, 256);

// For each diff offset that's within +56..+512 (likely AI policy area),
// classify the changed u32 by candidate semantic.
console.log(`\n===== Diff candidates in +56..+1024 (AI policy region) =====`);
const candidates = [];
for (const off of diffs) {
  if (off < 56 || off > 1024) continue;
  // Only print u32-aligned (or unaligned but distinct) interesting ones.
  if (off % 4 !== 0) continue;
  const vT1 = bufT1.readUInt32LE(r0T1 + off);
  const vT2 = bufT2.readUInt32LE(r0T2 + off);
  if (vT1 === vT2) continue;
  candidates.push({ off, vT1, vT2 });
}
for (const c of candidates.slice(0, 80)) {
  const t1Hex = c.vT1.toString(16).padStart(8, "0");
  const t2Hex = c.vT2.toString(16).padStart(8, "0");
  let note = "";
  // Faction-id heuristic: small int 0..32 or 0xFFFFFFFF (no target)
  if (c.vT1 < 50 || c.vT1 === 0xffffffff) note += "[T1: maybe-fid] ";
  if (c.vT2 < 50 || c.vT2 === 0xffffffff) note += "[T2: maybe-fid] ";
  console.log(`  rel +${c.off.toString().padStart(4)} (0x${c.off.toString(16).padStart(4, "0")}): ${t1Hex} → ${t2Hex}   ${note}`);
}

// Also: scan for u32 == another major-record's index value
// (i.e. an enum 0..22). Report what values dominate among diffs.
const valuesT1 = candidates.map(c => c.vT1).filter(v => v < 50);
const valuesT2 = candidates.map(c => c.vT2).filter(v => v < 50);
console.log(`\nSmall-int candidate values (potential faction ids):`);
console.log(`  T1 side: [${[...new Set(valuesT1)].sort((a, b) => a - b).join(", ")}]`);
console.log(`  T2 side: [${[...new Set(valuesT2)].sort((a, b) => a - b).join(", ")}]`);
