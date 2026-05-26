// Broader treasury search — find u32 values in the plausible treasury range
// (1000-15000) where T2 = T1 + (500..3000) and the value isn't a stat or count

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

console.log('T1 size: ' + T1.length);
console.log('T2 size: ' + T2.length);

// 0x2c5e1 candidate from previous session — verify
console.log('\n=== Verify earlier candidate 0x2c5e1 ===');
if (0x2c5e1 + 4 <= T1.length && 0x2c5e1 + 4 <= T2.length) {
  console.log('  T1@0x2c5e1: ' + T1.readUInt32LE(0x2c5e1));
  console.log('  T2@0x2c5e1: ' + T2.readUInt32LE(0x2c5e1));
}

// Also check 0x2c5dd, 0x2c5e5 (4-byte aligned nearby)
for (let off = 0x2c5d0; off <= 0x2c5f0; off += 4) {
  if (off + 4 <= T1.length && off + 4 <= T2.length) {
    console.log('  u32@0x' + off.toString(16) + ' T1=' + T1.readUInt32LE(off) + ' T2=' + T2.readUInt32LE(off));
  }
}

// Broader scan: find any u32 where T1 is in [1000,15000] and T2-T1 in [200, 3000]
// AND the value is not a multiple of 256 (not fixed-point)
const candidates = [];
const minLen = Math.min(T1.length, T2.length);
for (let off = 0x1000; off < minLen - 4; off += 4) {
  const v1 = T1.readUInt32LE(off);
  const v2 = T2.readUInt32LE(off);
  if (v1 < 1000 || v1 > 15000) continue;
  const d = v2 - v1;
  if (d < 200 || d > 3000) continue;
  if (v1 % 256 === 0) continue;
  if (v2 % 256 === 0) continue;
  candidates.push({ off, v1, v2, delta: d });
}
console.log('\n=== Aligned candidates: T1 in [1000,15000], T2-T1 in [200,3000] ===');
console.log('Total: ' + candidates.length);
candidates.sort((a, b) => Math.abs(a.delta - 1500) - Math.abs(b.delta - 1500));
console.log('Top 25 closest to delta=1500:');
for (const c of candidates.slice(0, 25)) {
  console.log('  u32@0x' + c.off.toString(16) + ' T1=' + c.v1 + ' T2=' + c.v2 + ' Δ=+' + c.delta);
}

// Also: find the FACTION_ECONOMICS section in the body by searching for u32=91 (type id)
// followed by what looks like records.
console.log('\n=== Search for FACTION_ECONOMICS section header ===');
// The "FACTION_ECONOMICS" ASCII shouldn't appear in body (it's only in registry),
// but the SECTION HEADER uses the type ID directly. In RTW saves, sections often
// have a u32 type-id header. Let me look for 91 (0x5b 00 00 00) at every position
// in body and check if the next 4 bytes look like a section size.
const sectionType91 = Buffer.from([0x5b, 0x00, 0x00, 0x00]);
let p = 0x3000;
let foundCount = 0;
while (p < T1.length - 16 && foundCount < 20) {
  if (T1[p] === 0x5b && T1[p+1] === 0x00 && T1[p+2] === 0x00 && T1[p+3] === 0x00) {
    // Check if next u32 looks like a size (small to medium)
    const sz = T1.readUInt32LE(p + 4);
    if (sz > 16 && sz < 0x10000) {
      console.log('  u32=91 @ 0x' + p.toString(16) + ' followed by size=' + sz);
      foundCount++;
    }
  }
  p++;
}
