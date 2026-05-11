// dig-section3.js — section walker with name extraction
//
// Many sections begin with [u32 self][u32 size][u32 unknown][u16 len][ASCIIZ name].
// Extract those names and produce a histogram.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findRootSection(buf) {
  let best = null;
  for (let i = 0x3000; i + 8 < buf.length - 1000000; i += 1) {
    if (buf.readUInt32LE(i) !== i) continue;
    const size = buf.readUInt32LE(i + 4);
    if (size < 1000000 || size > buf.length - i) continue;
    if (!best || size > best.size) {
      best = { offset: i, size };
    }
  }
  return best;
}

function getChildren(buf, sectStart, sectSize) {
  const children = [];
  const payloadEnd = sectStart + sectSize;
  let p = sectStart + 8;
  while (p + 8 < payloadEnd) {
    if (buf.readUInt32LE(p) === p) {
      const childSize = buf.readUInt32LE(p + 4);
      if (childSize >= 8 && p + childSize <= payloadEnd) {
        children.push({ offset: p, size: childSize });
        p += childSize;
        continue;
      }
    }
    p += 1;
  }
  return children;
}

// Try to read a u16-length-prefixed ASCII name near the start of a section payload.
// Common pattern is [u32 self][u32 size][u32 hash][u16 nameLen][ASCIIZ name].
function tryReadName(buf, sectStart, sectSize) {
  // Look at multiple candidate positions for a u16 length prefix
  for (const off of [12, 14, 16, 20, 24]) {
    if (sectStart + off + 4 >= sectStart + sectSize) continue;
    const len = buf.readUInt16LE(sectStart + off);
    if (len < 4 || len > 60) continue;
    if (sectStart + off + 2 + len > sectStart + sectSize) continue;
    // Check the bytes are ASCII letters/underscores
    const nameStart = sectStart + off + 2;
    let ok = true;
    for (let j = 0; j < len; j++) {
      const c = buf[nameStart + j];
      if (j === len - 1 && c === 0) continue;
      if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 32 || (c >= 48 && c <= 57))) { ok = false; break; }
    }
    if (ok) {
      const name = buf.slice(nameStart, nameStart + len).toString('ascii').replace(/\0/g, '').trim();
      if (name.length >= 3) return { offset: off, name };
    }
  }
  return null;
}

const buf = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const root = findRootSection(buf);
console.log(`Root: 0x${root.offset.toString(16)} size=${root.size}`);

// Walk recursively, collecting all sections with their name (if any)
const allSections = [];
function walk(sectStart, sectSize, depth = 0) {
  if (depth > 12) return;
  const children = getChildren(buf, sectStart, sectSize);
  for (const c of children) {
    const name = tryReadName(buf, c.offset, c.size);
    allSections.push({ ...c, depth: depth + 1, name: name ? name.name : null });
    walk(c.offset, c.size, depth + 1);
  }
}

walk(root.offset, root.size);
console.log(`Walked ${allSections.length} total sections under root`);

// Histogram of names
const nameCounts = {};
for (const s of allSections) {
  if (s.name) nameCounts[s.name] = (nameCounts[s.name] || 0) + 1;
}
const namedCount = allSections.filter(s => s.name).length;
console.log(`\n${namedCount} sections have an identifiable u16-prefixed ASCII name`);

// Top 50 names
const topNames = Object.entries(nameCounts).sort((a, b) => b[1] - a[1]).slice(0, 50);
console.log("\nTop named sections by count:");
for (const [n, c] of topNames) {
  console.log(`  ${String(c).padStart(5)} × ${n}`);
}

// Also: count by depth
const depthCounts = {};
for (const s of allSections) {
  depthCounts[s.depth] = (depthCounts[s.depth] || 0) + 1;
}
console.log("\nSection counts by depth:");
for (const [d, c] of Object.entries(depthCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  depth ${d}: ${c} sections`);
}

// Distinct names list
console.log(`\nTotal distinct names: ${Object.keys(nameCounts).length}`);
// Names that appear only once or a few times — likely unique structural sections
const rareNames = Object.entries(nameCounts).filter(([_, c]) => c < 5).sort((a, b) => a[1] - b[1]).slice(0, 80);
console.log(`\nRare named sections (occur < 5 times) — likely unique/structural:`);
for (const [n, c] of rareNames) {
  console.log(`  ${c} × ${n}`);
}
