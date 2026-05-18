// Section walker. Per save-cracker memory:
//   taw section invariant: {u32 self_ptr == pos, u32 size, [size bytes]}
//   section type registry at 0x500-0xde0
//
// Walk forward from the registry end, identifying sections by self_ptr
// match. Build a section index. Treasury lives in FACTION_ECONOMICS
// (registry ID 91, count 36).

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

console.log(`file size: 0x${buf.length.toString(16)} (${buf.length})`);

// Try to walk taw sections starting from various candidate origins.
// Section invariant: u32 at offset = the offset itself.
function tryWalk(start, maxSections = 100) {
  let off = start;
  const sections = [];
  while (sections.length < maxSections && off + 8 < buf.length) {
    const selfPtr = u32(off);
    const size = u32(off + 4);
    if (selfPtr !== off) return sections;
    if (size > buf.length - off - 8) return sections;
    if (size === 0) return sections;
    sections.push({ off, size, end: off + 8 + size });
    off = off + 8 + size;
  }
  return sections;
}

// Find candidate starts by scanning for "self_ptr == position" pattern
console.log("\nfinding all positions where u32 == position (taw section start candidates):");
const candidates = [];
for (let off = 0x100; off < Math.min(buf.length, 0x100000); off += 4) {
  if (u32(off) === off) candidates.push(off);
}
console.log(`candidates < 0x100000: ${candidates.length}`);
console.log("first 10:", candidates.slice(0, 10).map(c => "0x" + c.toString(16)));

// For each candidate, try to walk forward and see how many consecutive
// valid sections we get
console.log("\nwalking from each candidate:");
const walkResults = [];
for (const c of candidates.slice(0, 30)) {
  const w = tryWalk(c, 20);
  walkResults.push({ start: c, count: w.length, last: w[w.length - 1] });
  if (w.length >= 3) {
    console.log(`  0x${c.toString(16)}: ${w.length} sections, last ends at 0x${(w[w.length - 1].end).toString(16)}`);
  }
}

// Find the START candidate that yields the longest walk
walkResults.sort((a, b) => b.count - a.count);
console.log(`\nbest walk: ${walkResults[0]?.count} sections from 0x${walkResults[0]?.start.toString(16)}`);

// Walk the best candidate fully and dump section sizes
if (walkResults[0]?.count > 5) {
  const full = tryWalk(walkResults[0].start, 200);
  console.log(`\nfull walk from 0x${walkResults[0].start.toString(16)}:`);
  for (let i = 0; i < Math.min(40, full.length); i++) {
    const s = full[i];
    console.log(`  ${i.toString().padStart(3)}: 0x${s.off.toString(16).padStart(8, '0')}  size=${s.size.toString().padStart(10)}  ends 0x${s.end.toString(16)}`);
  }
  console.log(`  ... total ${full.length} sections, last ends 0x${full[full.length - 1].end.toString(16)}`);
}
