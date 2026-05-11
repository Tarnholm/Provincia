// dig-section-walker2.js — examine each child section's payload to identify
// schema. For each child, dump the first 64 bytes of payload to see what's
// at the start.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// HST
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
    hst.push({ off: ns, name, ver });
    i += 5;
  }
}
console.log(`HST: ${hst.length} entries`);

// Find body root
const hstEnd = hst[hst.length-1].off + hst[hst.length-1].name.length + 5;
let bodyRoot = -1;
for (let i = hstEnd; i < hstEnd + 200; i++) {
  if (buf.readUInt32LE(i) === i) { bodyRoot = i; break; }
}
const bodySize = buf.readUInt32LE(bodyRoot + 4);
console.log(`Body root @0x${bodyRoot.toString(16)} size=${bodySize}`);

// Get child sections
function findDirectChildren(parentStart, parentSize) {
  const payloadStart = parentStart + 8;
  const payloadEnd = parentStart + parentSize;
  const children = [];
  for (let p = payloadStart; p + 8 <= payloadEnd; p += 4) {
    if (buf.readUInt32LE(p) !== p) continue;
    const sz = buf.readUInt32LE(p + 4);
    if (sz < 16) continue;
    if (p + sz > payloadEnd) continue;
    children.push({ off: p, size: sz });
  }
  // Non-overlap greedy
  children.sort((a, b) => a.off - b.off);
  const accepted = [];
  let lastEnd = parentStart + 8;
  for (const c of children) {
    if (c.off < lastEnd) continue;
    accepted.push(c);
    lastEnd = c.off + c.size;
  }
  return accepted;
}

const kids = findDirectChildren(bodyRoot, bodySize);
console.log(`Body root has ${kids.length} direct children`);

// What's BEFORE child[0]? Inspect 0x3ba1 (body root payload start) to 0x51ad.
console.log(`\nGap from body payload start (0x${(bodyRoot+8).toString(16)}) to child[0] (0x${kids[0].off.toString(16)}): ${kids[0].off - bodyRoot - 8} bytes`);

// Check if there's a u32 schema-tag at payload start
const tagU32 = buf.readUInt32LE(bodyRoot + 8);
const tagU16 = buf.readUInt16LE(bodyRoot + 8);
console.log(`Payload[0..3] = u32=${tagU32} = 0x${tagU32.toString(16)}; u16=${tagU16}`);

// First 64 bytes of payload
let s = "";
for (let j = 0; j < 64; j++) s += buf[bodyRoot+8+j].toString(16).padStart(2,'0') + ' ';
console.log(`First 64 bytes of body payload: ${s}`);

// Now examine each child's payload first 32 bytes
console.log(`\nFirst 30 children — first 4 u32s of payload:`);
const sizeGroups = {};
for (let i = 0; i < Math.min(kids.length, 50); i++) {
  const c = kids[i];
  const p = c.off + 8;
  const u32a = buf.readUInt32LE(p);
  const u32b = buf.readUInt32LE(p + 4);
  const u32c = buf.readUInt32LE(p + 8);
  // Look for ASCIIZ early
  let str = "";
  for (let j = 0; j < 64 && p + j < buf.length; j++) {
    const ch = buf[p+j];
    if (ch >= 0x20 && ch < 0x7f) str += String.fromCharCode(ch);
    else str += '.';
  }
  console.log(`  [${i}] @0x${c.off.toString(16)} sz=${c.size}: ${u32a} ${u32b} ${u32c} | "${str.slice(0, 32)}"`);
  sizeGroups[c.size] = (sizeGroups[c.size] || 0) + 1;
}

console.log("\nSize-grouping of children:");
const sg = Object.entries(sizeGroups).sort((a,b) => b[1] - a[1]).slice(0, 15);
for (const [sz, n] of sg) console.log(`  ${n} × size=${sz}`);
