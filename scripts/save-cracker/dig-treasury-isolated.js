// Check the unique 10000 hit and the isolated 5000 hits for treasury context.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const t1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// 10000 unique hit at 0x827bd
console.log('=== 10000 (unique hit) at 0x827bd ===');
for (let row = -3; row <= 3; row++) {
  const addr = 0x827bd + row * 16;
  console.log('  0x' + addr.toString(16) + ': ' + hex(t1, addr, 16) + (row === 0 ? ' ← =10000' : ''));
}

// Find all u32=5000 in the range 0x100..0x90000 and check isolation
function findU32(buf, value, range) {
  const hits = [];
  const target = Buffer.alloc(4);
  target.writeUInt32LE(value, 0);
  let p = range[0];
  while ((p = buf.indexOf(target, p)) !== -1 && p < range[1]) {
    hits.push(p);
    p++;
  }
  return hits;
}

console.log('\n=== All 5000 u32 hits with context ===');
const hits = findU32(t1, 5000, [0x100, 0x90000]);
for (const h of hits) {
  // Filter aligned-to-4 hits since treasury would be aligned
  if (h % 4 !== 0) continue;
  // Check neighbors
  const nb_m4 = t1.readUInt32LE(h - 4);
  const nb_p4 = t1.readUInt32LE(h + 4);
  console.log('  0x' + h.toString(16) + ' (aligned): prev=' + nb_m4 + ' next=' + nb_p4);
}

// Cross-check: does 0x827bd in T2/T3/T4 hold values consistent with treasury growth?
console.log('\n=== 0x827bd across all turns (treasury-growth test) ===');
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const v32 = buf.readUInt32LE(0x827bd);
  const v16 = buf.readUInt16LE(0x827bd);
  console.log('  ' + f.padEnd(70) + ' u32=' + v32 + ' u16=' + v16);
}

// Also try a tighter content-search: NEUTRAL u32 values 4000-15000 with isolation
console.log('\n=== u32 in 4000-15000 with all-zero neighbors ===');
let n = 0;
for (let off = 0x100; off < 0x90000 - 4; off += 4) {
  const v = t1.readUInt32LE(off);
  if (v < 4000 || v > 15000) continue;
  const m4 = t1.readUInt32LE(off - 4);
  const p4 = t1.readUInt32LE(off + 4);
  // ZERO on both sides → very isolated
  if (m4 !== 0 || p4 !== 0) continue;
  console.log('  u32@0x' + off.toString(16) + ' = ' + v);
  n++;
  if (n > 30) break;
}
