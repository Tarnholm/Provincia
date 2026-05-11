// dig-section5.js — full recursive section walker
//
// Walk EVERY self-pointer in the file, then build the parent-child tree by
// nesting (a section A contains B iff A.offset < B.offset < A.offset+A.size).

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const buf = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));

// Find every self-pointer in the file that has a plausible size after it.
const allSections = [];
console.log("Scanning entire file for self-pointing sections...");
for (let i = 0x3000; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== i) continue;
  const size = buf.readUInt32LE(i + 4);
  if (size < 8 || size > buf.length - i) continue;
  // Filter: size shouldn't be ridiculous (max file size minus header)
  if (size > buf.length - 0x1000) continue;
  allSections.push({ offset: i, size });
}
console.log(`Found ${allSections.length} candidate sections`);

// Build parent-child by sweeping in order: each section has a parent = innermost
// containing section.
allSections.sort((a, b) => a.offset - b.offset || b.size - a.size);

// For each section, scan its immediate children: find sections starting inside it
// whose parent isn't already deeper.
const sectionByOff = new Map();
for (const s of allSections) sectionByOff.set(s.offset, s);

// Build parent map via stack
const parentOf = new Map();
{
  const stack = [];  // sections we're inside
  for (const s of allSections) {
    // Pop sections that no longer contain s
    while (stack.length > 0 && stack[stack.length - 1].offset + stack[stack.length - 1].size <= s.offset) {
      stack.pop();
    }
    if (stack.length > 0) parentOf.set(s.offset, stack[stack.length - 1]);
    stack.push(s);
  }
}

// Compute depth from root
function depthOf(s) {
  let d = 0;
  let cur = s;
  while (parentOf.has(cur.offset)) {
    cur = parentOf.get(cur.offset);
    d++;
  }
  return d;
}

const depthCounts = {};
for (const s of allSections) {
  const d = depthOf(s);
  depthCounts[d] = (depthCounts[d] || 0) + 1;
}
console.log(`\nSection counts by depth (0 = top-level):`);
for (const [d, c] of Object.entries(depthCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  depth ${d}: ${c} sections`);
}

// For each section, try to extract a name token within its first ~200 bytes of payload
function findNameInRange(buf, start, end) {
  for (let i = start; i + 4 < end; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 4 || len > 60) continue;
    if (i + 2 + len > end) continue;
    let alpha = 0, ok = true;
    for (let j = 0; j < len; j++) {
      const c = buf[i + 2 + j];
      if (j === len - 1 && c === 0) continue;
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) alpha++;
      else if (c === 95 || c === 32 || (c >= 48 && c <= 57)) {}
      else { ok = false; break; }
    }
    if (ok && alpha >= 4) {
      const name = buf.slice(i + 2, i + 2 + len).toString('ascii').replace(/\0/g, '').trim();
      if (name.length >= 4 && /^[a-z]/i.test(name)) return { offset: i, name };
    }
  }
  return null;
}

// Tag each section with a name (if we can find one in its payload before child sections)
const named = [];
for (const s of allSections) {
  const payloadEnd = Math.min(s.offset + 8 + 200, s.offset + s.size);
  const name = findNameInRange(buf, s.offset + 8, payloadEnd);
  if (name) named.push({ ...s, name: name.name });
}
console.log(`\n${named.length} sections have an ASCII name within first 200 bytes of payload`);

const nameCounts = {};
for (const s of named) nameCounts[s.name] = (nameCounts[s.name] || 0) + 1;
const top = Object.entries(nameCounts).sort((a, b) => b[1] - a[1]);
console.log(`\nTop 80 names:`);
for (const [n, c] of top.slice(0, 80)) console.log(`  ${String(c).padStart(6)} × ${n}`);

// Single-occurrence names — these are unique structural sections
const uniques = top.filter(([_, c]) => c === 1);
console.log(`\n${uniques.length} unique named sections (occur exactly once):`);
for (const [n, c] of uniques.slice(0, 50)) console.log(`  ${n}`);

console.log(`\nTotal distinct names: ${top.length}`);
