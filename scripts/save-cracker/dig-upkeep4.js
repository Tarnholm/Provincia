// dig-upkeep4.js — session 9
//
// New hypothesis: the trailing data is a sequence of EMBEDDED SECTIONS.
// Each section has the taw invariant {u32 self-ptr at N, u32 size at N+4, payload}
// or the variant {u32 self-ptr, u32 inner self-ptr, payload}.
//
// Strategy:
//   - Walk the player record's bytes looking for self-pointers.
//   - Section signature: u32 == position. These delimit sub-records.
//   - Build a section tree for the player record (rome5).
//   - Compare with rome7 to find which sub-records changed.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findMajorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readInt32LE(i);
    hits.push({ pos: i, treasury, regionCount });
  }
  return hits;
}

// Find every self-pointing u32 in [start, end) — these are section anchors
function findSelfPointers(buf, start, end) {
  const out = [];
  for (let i = start; i + 4 <= end; i += 1) {
    if (buf.readUInt32LE(i) === i) out.push(i);
  }
  return out;
}

const r5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const r7 = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const r5recs = findMajorRecords(r5);
const r7recs = findMajorRecords(r7);

const p5 = r5recs[0]; // Romans Julii
const p7 = r7recs[0];
const end5 = r5recs[1].pos;
const end7 = r7recs[1].pos;

console.log(`Player record rome5: 0x${p5.pos.toString(16)} .. 0x${end5.toString(16)} (size ${end5 - p5.pos})`);
console.log(`Player record rome7: 0x${p7.pos.toString(16)} .. 0x${end7.toString(16)} (size ${end7 - p7.pos})`);

const sp5 = findSelfPointers(r5, p5.pos, end5);
const sp7 = findSelfPointers(r7, p7.pos, end7);

console.log(`\n${sp5.length} self-pointers in player rec rome5`);
console.log(`${sp7.length} self-pointers in player rec rome7`);

// Look at the first 30 self-pointers, with their relative offsets and what comes after them
console.log("\n=== rome5 player rec: first 30 self-pointers (relative offset, then next 16 bytes) ===");
for (let i = 0; i < Math.min(sp5.length, 30); i++) {
  const off = sp5[i] - p5.pos;
  const next16 = Array.from(r5.slice(sp5[i] + 4, sp5[i] + 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const next_u32_0 = r5.readUInt32LE(sp5[i] + 4);
  const next_u32_4 = r5.readUInt32LE(sp5[i] + 8);
  console.log(`  +${off.toString().padStart(6)} (abs 0x${sp5[i].toString(16)}): next u32=${next_u32_0}, next+4=${next_u32_4}, bytes=${next16}`);
}

// The structure {u32 self == pos, u32 self+1, ...} pattern means the section header is at pos.
// We need to find SECTION HEADERS, which are pairs (self_at_p, self_at_p+something).
// Look for adjacent self-pointers within ~32 bytes: those are likely double-anchored sections.

const sections5 = [];
for (let i = 0; i < sp5.length; i++) {
  for (let j = i + 1; j < sp5.length && sp5[j] - sp5[i] < 64; j++) {
    sections5.push({ first: sp5[i], second: sp5[j], gap: sp5[j] - sp5[i] });
  }
}

// Top section-shape patterns: gap == 16 (faction-record-style: self_at_pos+24, self_at_pos+40) is the major signature
// Let's see common gaps
const gapCounts = {};
for (const s of sections5) {
  gapCounts[s.gap] = (gapCounts[s.gap] || 0) + 1;
}
console.log("\n=== Common gaps between adjacent self-pointers (rome5 player rec) ===");
for (const [gap, count] of Object.entries(gapCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  gap=${gap}: ${count} pairs`);
}

// Pairs with gap=16 (mirror major-faction's structure: self at +24 and +40)
console.log("\n=== gap=16 pairs in rome5 player rec (first 30; these are embedded sections following the major shape) ===");
const gap16 = sections5.filter(s => s.gap === 16).slice(0, 30);
for (const s of gap16) {
  const off = s.first - p5.pos;
  const sub_size = r5.readUInt32LE(s.second + 4);  // For major, this is `6`. For embedded sub-sections, varies.
  console.log(`  +${off.toString().padStart(6)}: first=0x${s.first.toString(16)}, second=0x${s.second.toString(16)}, sub_size_after_second=${sub_size}`);
}
