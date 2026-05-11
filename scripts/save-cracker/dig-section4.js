// dig-section4.js — section walker with scan-based name extraction
//
// Don't try fixed-offset names. Instead, scan each section's payload for any
// u16-prefixed ASCII string that looks like a section/record tag.

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

// Look at the FIRST u16-prefixed ASCII name within the section's payload (excluding nested sections).
function findFirstName(buf, sectStart, sectSize) {
  const payloadEnd = sectStart + sectSize;
  // Skip header (8 bytes), then scan first 256 bytes of payload
  const scanEnd = Math.min(sectStart + 8 + 256, payloadEnd);
  for (let i = sectStart + 8; i + 4 < scanEnd; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 4 || len > 60) continue;
    if (i + 2 + len > payloadEnd) continue;
    let ok = true;
    let alpha = 0;
    for (let j = 0; j < len; j++) {
      const c = buf[i + 2 + j];
      if (j === len - 1 && c === 0) continue;
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) alpha++;
      else if (c === 32 || (c >= 48 && c <= 57)) {} // ok
      else { ok = false; break; }
    }
    if (ok && alpha >= 4) {
      const name = buf.slice(i + 2, i + 2 + len).toString('ascii').replace(/\0/g, '').trim();
      if (name.length >= 4 && /^[a-z]/i.test(name)) return { name, offset: i };
    }
  }
  return null;
}

const buf = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const root = findRootSection(buf);
console.log(`Root: 0x${root.offset.toString(16)} size=${root.size}`);

const allSections = [];
function walk(sectStart, sectSize, depth = 0) {
  if (depth > 12) return;
  const children = getChildren(buf, sectStart, sectSize);
  for (const c of children) {
    const name = findFirstName(buf, c.offset, c.size);
    allSections.push({ ...c, depth: depth + 1, name: name ? name.name : null });
    walk(c.offset, c.size, depth + 1);
  }
}

walk(root.offset, root.size);
console.log(`Walked ${allSections.length} total sections under root`);

const namedCount = allSections.filter(s => s.name).length;
console.log(`${namedCount} sections have an identifiable name string nearby`);

const nameCounts = {};
for (const s of allSections) {
  if (s.name) nameCounts[s.name] = (nameCounts[s.name] || 0) + 1;
}

const topNames = Object.entries(nameCounts).sort((a, b) => b[1] - a[1]).slice(0, 60);
console.log("\nTop named sections by count:");
for (const [n, c] of topNames) {
  console.log(`  ${String(c).padStart(5)} × ${n}`);
}

console.log(`\nTotal distinct names: ${Object.keys(nameCounts).length}`);
const all = Object.entries(nameCounts).sort((a, b) => b[1] - a[1]);
console.log(`\nAll names (occurrence count, name):`);
for (const [n, c] of all) {
  console.log(`  ${String(c).padStart(5)} × ${n}`);
}
