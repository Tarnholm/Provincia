// dig-section-walker3.js — production section walker w/ content classification.
//
// Each section is classified by its payload signature into:
//   character_record: contains "data/ui/" portrait path
//   settlement_record: contains UTF-16LE city-name marker + "default_set"
//   faction_record: matches +8=100,+12=1 signature (treasury card)
//   coord_section: payload is mostly u32 pairs in coord range (0..1500)
//   unit_record: contains a unit name from descr_unit / starts with [u16 nameLen][asciz]
//   small_section: <100 bytes
//   unknown
//
// Goal: produce an authoritative section taxonomy across the file.

const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
console.log(`File: ${path.basename(SAVE)} (${buf.length} bytes)`);

// Find ALL self-pointers globally (strict, must point to self, have valid size)
const all = [];
for (let i = 0; i + 8 < buf.length; i += 4) {
  if (buf.readUInt32LE(i) !== i) continue;
  const sz = buf.readUInt32LE(i + 4);
  if (sz < 16) continue;
  if (i + sz > buf.length) continue;
  all.push({ off: i, size: sz });
}
console.log(`All self-pointing sections (file-wide, u32-aligned): ${all.length}`);

// Build top-level tree: a top-level section is one not strictly contained by
// any other (offset is unique max-parent-chain root).
all.sort((a, b) => a.off - b.off || b.size - a.size);
const containedBy = new Map();
{
  const stack = [];
  for (const s of all) {
    while (stack.length && stack[stack.length-1].off + stack[stack.length-1].size <= s.off) stack.pop();
    if (stack.length) containedBy.set(s.off, stack[stack.length-1]);
    stack.push(s);
  }
}
const topLevel = all.filter(s => !containedBy.has(s.off));
console.log(`Top-level sections: ${topLevel.length}`);
for (const s of topLevel.slice(0, 10)) console.log(`  0x${s.off.toString(16)} size=${s.size}`);

// Define the body root as the largest top-level section.
const root = topLevel.sort((a,b) => b.size - a.size)[0];
console.log(`\nLargest top-level: 0x${root.off.toString(16)} size=${root.size}`);

// Get direct children of root via non-overlapping greedy walk
function directChildrenOf(parent) {
  const out = [];
  let lastEnd = parent.off + 8;
  for (const s of all) {
    if (s.off < lastEnd) continue;
    if (s.off >= parent.off + parent.size) break;
    if (s.off + s.size > parent.off + parent.size) continue;
    if (containedBy.get(s.off) !== parent && containedBy.get(s.off) !== undefined) {
      // skip sections that are inside another child
      continue;
    }
    out.push(s);
    lastEnd = s.off + s.size;
  }
  return out;
}

// Classify a section by content
function classify(s) {
  const p = s.off + 8;
  const slice = buf.slice(p, Math.min(p + Math.min(s.size - 8, 4096), buf.length));
  // Has "data/ui/"?
  if (slice.indexOf(Buffer.from("data/ui/", "ascii")) >= 0) return "char_record";
  // Has "default_set"?
  if (slice.indexOf(Buffer.from("default_set", "ascii")) >= 0) return "settlement_record";
  // Has "core_building"?
  if (slice.indexOf(Buffer.from("core_building", "ascii")) >= 0) return "settlement_record";
  // u32 at +8 = 100, signals faction-class record (but section header is 0..7, so check +16)
  // Section payload starts at p; check if p+8=100, p+12=1
  if (s.size >= 64) {
    const v8 = buf.readUInt32LE(p + 0);
    if (v8 === 100 && buf.readUInt32LE(p + 4) === 1) return "faction_record";
  }
  // u32 coord-pair pattern: count pairs in [(1..1500), (1..1500)]
  const pmax = Math.min(s.size - 8, 200);
  let pairs = 0, total = 0;
  for (let i = 0; i + 8 <= pmax; i += 8) {
    const a = buf.readUInt32LE(p + i);
    const b = buf.readUInt32LE(p + i + 4);
    total++;
    if (a >= 1 && a <= 1500 && b >= 1 && b <= 1500) pairs++;
  }
  if (total > 4 && pairs / total > 0.7) return "coord_pairs";
  if (s.size < 100) return "small";
  return "unknown";
}

const kids = directChildrenOf(root);
console.log(`Body root direct children: ${kids.length}`);

const classifyCounts = {};
const classifySizes = {};
for (const k of kids) {
  const cls = classify(k);
  classifyCounts[cls] = (classifyCounts[cls] || 0) + 1;
  if (!classifySizes[cls]) classifySizes[cls] = [];
  classifySizes[cls].push(k.size);
}
console.log("\nBody root children classification:");
for (const [c, n] of Object.entries(classifyCounts).sort((a, b) => b[1] - a[1])) {
  const sizes = classifySizes[c];
  const avg = (sizes.reduce((s, v) => s + v, 0) / sizes.length).toFixed(0);
  const min = Math.min(...sizes), max = Math.max(...sizes);
  console.log(`  ${String(n).padStart(5)} × ${c.padEnd(20)} size avg=${avg} min=${min} max=${max}`);
}

// Also classify the LARGER top-level sections
console.log("\nTop 10 sections file-wide (after the body root):");
const sorted = all.filter(s => s !== root).sort((a, b) => b.size - a.size).slice(0, 10);
for (const s of sorted) {
  const cls = classify(s);
  console.log(`  0x${s.off.toString(16)} size=${s.size} → ${cls}`);
}

// Walk the 16MB settlement section
const setOff = sorted[0].off;
const setSize = sorted[0].size;
console.log(`\nSettlement zone @0x${setOff.toString(16)} size=${setSize}`);
const setKids = directChildrenOf({ off: setOff, size: setSize });
console.log(`Direct children: ${setKids.length}`);
const setCls = {};
for (const k of setKids) {
  const cls = classify(k);
  setCls[cls] = (setCls[cls] || 0) + 1;
}
for (const [c, n] of Object.entries(setCls).sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${c}`);
