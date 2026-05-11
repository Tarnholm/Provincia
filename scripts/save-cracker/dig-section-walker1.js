// dig-section-walker1.js — production-quality recursive section walker.
//
// Algorithm:
// 1. Locate the body root (first self-pointer after HST table).
// 2. Walk the root payload looking for child sections in sequence: at the
//    current position, expect either a 4-byte field (counter/flag/data) or
//    a self-pointer that starts a child section.
// 3. For each found section: extract its first byte after the [u32 off][u32 size] header.
//    Classify by content (named cstring, sub-section grammar, faction record, etc.)
//
// Goals:
// - Cleanly traverse the body's section tree
// - Strict false-positive filter (parent-child containment, size sanity)
// - Cross-reference sections with HST schema names where possible

const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
console.log(`File: ${path.basename(SAVE)} (${buf.length} bytes)`);

// Find HST table — scan 0x3000..0x4000 for ASCIIZ+u32(1..16) entries.
const hst = [];
{
  let i = 0x3000;
  while (i < 0x4000) {
    if (!(buf[i] >= 0x41 && buf[i] <= 0x5a)) { i++; continue; }
    const ns = i;
    while (i < buf.length) {
      const b = buf[i];
      if ((b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39) || b === 0x5f) i++;
      else break;
    }
    if (buf[i] !== 0) { i++; continue; }
    const ver = buf.readUInt32LE(i + 1);
    if (ver < 1 || ver > 16) { i++; continue; }
    const name = buf.slice(ns, i).toString('ascii');
    if (name.length < 3 || name.length > 64) { i++; continue; }
    hst.push({ off: ns, name, ver });
    i += 5;
  }
}
console.log(`HST entries: ${hst.length}`);

// Locate body root: first self-pointer after HST end
const hstEnd = hst.length ? hst[hst.length - 1].off + hst[hst.length - 1].name.length + 5 : 0x3b00;
console.log(`HST ends at 0x${hstEnd.toString(16)}`);

let bodyRoot = -1;
for (let i = hstEnd; i < hstEnd + 200; i++) {
  if (buf.readUInt32LE(i) === i) {
    bodyRoot = i;
    break;
  }
}
const bodySize = buf.readUInt32LE(bodyRoot + 4);
console.log(`Body root @0x${bodyRoot.toString(16)} size=${bodySize}`);

// Walk root payload as a sequence of nested sections.
// Each section starts with [u32 self][u32 size][payload], and the payload may
// contain further nested sections at variable offsets.

function isSection(p, parentEnd) {
  if (p + 8 > parentEnd) return false;
  if (buf.readUInt32LE(p) !== p) return false;
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 16 || p + sz > parentEnd) return false;
  return true;
}

// Strict walk: starting at pos inside parent, scan for direct child sections
// without descending more than maxDepth.
function findDirectChildren(parentStart, parentSize) {
  const payloadStart = parentStart + 8;
  const payloadEnd = parentStart + parentSize;
  const children = [];
  // Strategy A: scan every 4-byte aligned offset for a self-pointer that is
  // strictly inside the parent's payload AND has a valid size.
  for (let p = payloadStart; p + 8 <= payloadEnd; p += 4) {
    if (buf.readUInt32LE(p) !== p) continue;
    const sz = buf.readUInt32LE(p + 4);
    if (sz < 16) continue;
    if (p + sz > payloadEnd) continue;
    children.push({ off: p, size: sz });
  }
  return children;
}

// Build the full tree using parent-child containment.
function buildTree(parentStart, parentSize, maxDepth = 10) {
  const out = { off: parentStart, size: parentSize, children: [] };
  if (maxDepth <= 0) return out;
  const all = findDirectChildren(parentStart, parentSize);
  // Keep only NON-OVERLAPPING children: greedy by file order, skip any that
  // overlap an already-accepted one.
  all.sort((a, b) => a.off - b.off);
  let lastEnd = parentStart + 8;
  for (const c of all) {
    if (c.off < lastEnd) continue;
    out.children.push(buildTree(c.off, c.size, maxDepth - 1));
    lastEnd = c.off + c.size;
  }
  return out;
}

const tree = buildTree(bodyRoot, bodySize, 8);
console.log(`Body root has ${tree.children.length} direct children`);

// Print top-level children
for (let i = 0; i < Math.min(tree.children.length, 30); i++) {
  const c = tree.children[i];
  console.log(`  child[${i}] @0x${c.off.toString(16)} size=${c.size} grandchildren=${c.children.length}`);
}

// Depth histogram
function countDepth(node, d, hist) {
  hist[d] = (hist[d] || 0) + 1;
  for (const c of node.children) countDepth(c, d + 1, hist);
}
const dh = {};
countDepth(tree, 0, dh);
console.log(`\nDepth histogram:`);
for (const [d, c] of Object.entries(dh).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  depth ${d}: ${c} sections`);
}

// Total sections found
let total = 0;
function count(n) { total++; for (const c of n.children) count(c); }
count(tree);
console.log(`\nTotal sections under root: ${total}`);
