// dig-section-walker7.js — deeper inspection of the 287 children of body root.
// What ARE they?

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

function isSection(p, maxEnd) {
  if (p + 8 > maxEnd) return false;
  if (buf.readUInt32LE(p) !== p) return false;
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 16 || p + sz > maxEnd) return false;
  return true;
}
function walkSequential(start, end, max = 100000) {
  const found = [];
  for (let p = start; p + 8 <= end; p += 4) {
    if (!isSection(p, end)) continue;
    found.push({ off: p, size: buf.readUInt32LE(p + 4) });
  }
  found.sort((a, b) => a.off - b.off || b.size - a.size);
  const accepted = [];
  let lastEnd = start;
  for (const s of found) {
    if (s.off < lastEnd) continue;
    accepted.push(s);
    lastEnd = s.off + s.size;
    if (accepted.length >= max) break;
  }
  return accepted;
}

const body = { off: 0x3b99, size: 6488090 };
const kids = walkSequential(body.off + 8, body.off + body.size);
console.log(`Body root direct children: ${kids.length}`);

// Sample first 5 children — dump first 96 bytes
console.log(`\nFirst 5 children dump:`);
for (let i = 0; i < 5; i++) {
  const k = kids[i];
  console.log(`\n[${i}] @0x${k.off.toString(16)} size=${k.size}:`);
  let bytes = "";
  let asc = "";
  for (let j = 0; j < Math.min(128, k.size); j++) {
    bytes += buf[k.off + j].toString(16).padStart(2, '0');
    if (j % 4 === 3) bytes += ' ';
    const c = buf[k.off + j];
    asc += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '.';
  }
  console.log(`  bytes: ${bytes}`);
  console.log(`  ascii: "${asc}"`);
}

// child[0] is special — 13884 bytes vs ~700 for others. Inspect it.
console.log(`\n=== Special child[0] (13884 bytes) ===`);
const c0 = kids[0];
// Scan for ASCII strings within
let strs = [];
let p = c0.off + 8;
while (p < c0.off + c0.size) {
  // Look for length-prefixed strings
  const len = buf.readUInt16LE(p);
  if (len > 4 && len < 100 && p + 2 + len < c0.off + c0.size) {
    const str = buf.slice(p+2, p+2+len).toString('ascii');
    if (/^[a-zA-Z_][a-zA-Z0-9_/.]+/.test(str)) {
      strs.push({ off: p, len, str: str.slice(0, 40) });
      p += 2 + len;
      continue;
    }
  }
  p++;
}
console.log(`Found ${strs.length} potential strings in child[0]:`);
for (const s of strs.slice(0, 30)) console.log(`  @+${s.off - c0.off} len=${s.len} "${s.str}"`);

// Sample non-zero u32s
let p2 = c0.off + 8;
let u32s = [];
while (p2 + 4 < c0.off + c0.size) {
  const v = buf.readUInt32LE(p2);
  if (v !== 0 && v < 100000) u32s.push({ off: p2 - c0.off, v });
  p2 += 4;
}
console.log(`\nFirst 30 non-zero u32s (< 100000):`);
for (const u of u32s.slice(0, 30)) console.log(`  @+${u.off}: ${u.v}`);
