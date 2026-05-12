// dig-armyboard2.js — focus on what the +138B army-board pair actually carries.
// Already from dig-armyboard1.js we know:
//   - main insert 44B at 0x01504d84
//   - +17 at 0x01504d9c
//   - −5 at 0x01504dac
//   - −56 at 0x01504dc6
//   - +32 at 0x01504e96
//   - −20 at 0x01510d3d (boundary)
//   - +20 at 0x01510d85
//   - −5 at 0x01535779
//   - +5 at 0x0153586c
//   - +4 at 0x015358ba

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// Dump contexts at all known sites
const sites = [
  { off: 0x01504d84, name: '44B ins (1st)' },
  { off: 0x01504d9c, name: '17B ins (2nd)' },
  { off: 0x01504dac, name: '5B del' },
  { off: 0x01504dc6, name: '56B del' },
  { off: 0x01504e96, name: '32B ins' },
  { off: 0x01510d3d, name: '20B del' },
  { off: 0x01510d85, name: '20B ins' },
  { off: 0x01535779, name: '5B del' },
  { off: 0x0153586c, name: '5B ins' },
  { off: 0x015358ba, name: '4B ins' },
];

for (const s of sites) {
  console.log(`\n=== ${s.name} @ ${hex(s.off)} ===`);
  const lo = Math.max(0, s.off - 64);
  const hi = Math.min(A.length, s.off + 192);
  console.log(`A: ${A.subarray(lo, hi).toString('hex')}`);
  console.log(`B: ${B.subarray(lo, Math.min(B.length, s.off + 192 + 200)).toString('hex')}`);

  // ASCII run scan
  let asci = [];
  let start = -1;
  for (let i = lo; i < Math.min(s.off + 256, A.length); i++) {
    const c = A[i];
    if (c >= 0x20 && c < 0x7f) {
      if (start === -1) start = i;
    } else {
      if (start !== -1 && i - start >= 4) asci.push({ start, str: A.subarray(start, i).toString('ascii') });
      start = -1;
    }
  }
  for (const a of asci) console.log(`  A ascii ${hex(a.start)}: "${a.str}"`);

  asci = [];
  start = -1;
  for (let i = lo; i < Math.min(s.off + 256, B.length); i++) {
    const c = B[i];
    if (c >= 0x20 && c < 0x7f) {
      if (start === -1) start = i;
    } else {
      if (start !== -1 && i - start >= 4) asci.push({ start, str: B.subarray(start, i).toString('ascii') });
      start = -1;
    }
  }
  for (const a of asci) console.log(`  B ascii ${hex(a.start)}: "${a.str}"`);
}

// The +32B insert at 0x01504e96 looked like 4 entries of [u32 1][u32 tileID]
// (session 36 pattern for diplomat scout list — for an army boarding, similar)
console.log('\n=== Inspecting +32B insert at 0x01504e96 (the scout-list insert) ===');
const offIns = 0x01504e96;
const inserted = B.subarray(offIns, offIns + 32);
console.log(`Inserted bytes (32): ${inserted.toString('hex')}`);
console.log('Decoded as 4× [u32 1][u32 tile_id]:');
for (let i = 0; i < 32; i += 8) {
  const flag = inserted.readUInt32LE(i);
  const tileID = inserted.readUInt32LE(i + 4);
  console.log(`  ${i}: flag=${flag} tile=${tileID}`);
}
