// dig-section2.js — section walker continued
//
// Root is at 0xc4842 (size 29MB). Largest direct child is 23MB — that's the
// "world body" with all the per-section data. Walk into it and identify named
// children by their first ASCII bytes if possible.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findRootSection(buf) {
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

// Walk all immediate children of a section
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

const buf = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const root = findRootSection(buf);
console.log(`Root: 0x${root.offset.toString(16)} size=${root.size}`);

const rootChildren = getChildren(buf, root.offset, root.size);
console.log(`Root has ${rootChildren.length} direct children`);

const biggest = rootChildren.sort((a, b) => b.size - a.size)[0];
console.log(`Biggest child: 0x${biggest.offset.toString(16)} size=${biggest.size}`);

const bigChildren = getChildren(buf, biggest.offset, biggest.size);
console.log(`Biggest child has ${bigChildren.length} sub-children`);

// Group by size to find arrays
const sizeBuckets = {};
for (const c of bigChildren) sizeBuckets[c.size] = (sizeBuckets[c.size] || 0) + 1;
console.log("\nTop 30 size buckets in biggest child's children:");
const sizeTop = Object.entries(sizeBuckets).sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [s, cnt] of sizeTop) console.log(`  size=${s}: ${cnt} sections`);

// Look at the largest of the sub-children
const bigSub = bigChildren.sort((a, b) => b.size - a.size).slice(0, 5);
for (const c of bigSub) {
  console.log(`\nSize-${c.size} section at 0x${c.offset.toString(16)}:`);
  // Show first 64 bytes of payload as hex+ascii
  const slice = buf.slice(c.offset + 8, c.offset + Math.min(8 + 64, c.size));
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
  console.log(`  hex: ${hex}`);
  console.log(`  ascii: ${ascii}`);
}

// We previously found the major-faction records (signature: +8=100, +12=1, +24=self, +40=self, +44=6).
// Are these top-level children of the root or nested deeper?
// Let me find a known faction-record position (e.g. rome5 player at 0x154197a) and trace its path.
const playerRecPos = 0x154197a;
function findPath(buf, sectStart, sectSize, target, depth = 0, path = []) {
  if (depth > 8) return null;
  const payloadEnd = sectStart + sectSize;
  let p = sectStart + 8;
  while (p + 8 < payloadEnd) {
    if (buf.readUInt32LE(p) === p) {
      const childSize = buf.readUInt32LE(p + 4);
      if (childSize >= 8 && p + childSize <= payloadEnd) {
        if (p === target) {
          return [...path, { offset: p, size: childSize, depth }];
        }
        if (p < target && p + childSize > target) {
          return findPath(buf, p, childSize, target, depth + 1, [...path, { offset: p, size: childSize, depth }]);
        }
        p += childSize;
        continue;
      }
    }
    p += 1;
  }
  return null;
}

console.log(`\n\nPath from root to player major-record at 0x${playerRecPos.toString(16)}:`);
const targetPath = findPath(buf, root.offset, root.size, playerRecPos);
if (targetPath) {
  for (const n of targetPath) {
    console.log(`  depth=${n.depth} offset=0x${n.offset.toString(16)} size=${n.size}`);
  }
} else {
  console.log("  Path not found");
}
