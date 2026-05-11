// dig-section1.js — section walker stretch goal
//
// Goal: write a proper recursive taw section-tree extractor and dump
// section names that we haven't catalogued.
//
// taw section invariant:
//   struct Section { u32 absolute_offset; u32 size_bytes; u8 payload[size-8]; }
//   where the u32 at absolute_offset == absolute_offset (self-pointer).
//
// Dossier hints body root at ~0x3bad in some sample, but rome saves have it elsewhere.
// Approach: walk the file looking for self-pointers paired with reasonable sizes
// (size >= 8, total fits in file), and record the tree.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findRootSection(buf) {
  // Walk file looking for the LARGEST section starting near the start of the body.
  // Body root should have a size of several MB.
  let best = null;
  for (let i = 0x3000; i + 8 < buf.length - 1000000; i += 1) {
    if (buf.readUInt32LE(i) !== i) continue;
    const size = buf.readUInt32LE(i + 4);
    if (size < 1000000 || size > buf.length - i) continue;
    if (i + size > buf.length) continue;
    if (!best || size > best.size) {
      best = { offset: i, size };
    }
  }
  return best;
}

// Detect HST entries: name (ASCIIZ) + u32 version
function readHST(buf, start) {
  const entries = [];
  let p = start;
  while (p < buf.length - 16) {
    // Read ASCIIZ name
    const end = buf.indexOf(0, p);
    if (end < 0 || end - p > 64) break;
    const name = buf.slice(p, end).toString('ascii');
    if (name.length < 3 || !/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    const version = buf.readUInt32LE(end + 1);
    if (version > 100) break;
    entries.push({ name, version, pos: p });
    p = end + 5;
    if (entries.length > 200) break;
  }
  return entries;
}

const buf = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));

// Find HST first
// Try scanning from offset ~0x3328 onwards for the first ASCIIZ that looks like an HST entry
let hstStart = -1;
for (let i = 0x3000; i < 0x6000; i++) {
  // Look for the pattern: ASCIIZ ending then u32 version <= 100
  const end = buf.indexOf(0, i);
  if (end < 0 || end - i > 64 || end - i < 3) continue;
  const name = buf.slice(i, end).toString('ascii');
  if (!/^[A-Z][A-Z_0-9]*$/.test(name)) continue;
  // Now check if (end+1) has a u32 version <= 100
  const v = buf.readUInt32LE(end + 1);
  if (v <= 100 && v > 0) {
    // Try reading subsequent entries
    const entries = readHST(buf, i);
    if (entries.length >= 50) {
      hstStart = i;
      console.log(`HST found at 0x${i.toString(16)}, ${entries.length} entries`);
      break;
    }
  }
}

if (hstStart < 0) {
  console.log("HST not found");
}

// Find the root section
const root = findRootSection(buf);
console.log(`\nRoot section: offset=0x${root.offset.toString(16)} size=${root.size}`);

// Now walk children of the root section
function walkChildren(buf, sectStart, sectSize, depth = 0, maxDepth = 6, results = []) {
  if (depth > maxDepth) return results;
  const payloadStart = sectStart + 8;
  const payloadEnd = sectStart + sectSize;
  let p = payloadStart;
  // Find embedded self-pointing sections
  while (p + 8 < payloadEnd) {
    if (buf.readUInt32LE(p) === p) {
      const childSize = buf.readUInt32LE(p + 4);
      if (childSize >= 8 && p + childSize <= payloadEnd) {
        // Read first few bytes of payload for name hint
        const hint = buf.slice(p + 8, Math.min(p + 8 + 32, p + childSize)).toString('ascii').replace(/[^\x20-\x7e]/g, '.');
        results.push({ offset: p, size: childSize, depth, hint });
        // Recurse into child
        walkChildren(buf, p, childSize, depth + 1, maxDepth, results);
        p += childSize;
        continue;
      }
    }
    p += 1;
  }
  return results;
}

// Just children at depth 1 first
const directChildren = walkChildren(buf, root.offset, root.size, 0, 1);
console.log(`\nDirect children of root: ${directChildren.length}`);
const sizes = directChildren.map(c => c.size).sort((a,b)=>b-a);
console.log(`Top 20 child sizes:`, sizes.slice(0, 20));

// Show the first 30 direct children with hints
console.log("\nFirst 30 direct children:");
for (const c of directChildren.slice(0, 30)) {
  console.log(`  off=0x${c.offset.toString(16)} size=${c.size}  hint="${c.hint.slice(0, 32)}"`);
}
