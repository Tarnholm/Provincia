// Session 23: hash blob #7 — find correct alignment of the value=3 array, and look at the BIG picture.
// The value 3 appears every 16 bytes but not at offset 0 of each record. Find true record boundary.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// Find all positions in 0x1f442e0..0x1f47b00 where byte = 0x03
console.log(`=== Positions of byte 0x03 in 0x1f44200..0x1f47b00 (likely value=3 array) ===`);
const positions = [];
for (let p = 0x1f44200; p < 0x1f47b00; p++) {
  if (buf[p] === 0x03 && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) {
    positions.push(p);
  }
}
console.log(`Found ${positions.length} positions with 03 00 00 00 u32 = 3`);
console.log(`First 20: ${positions.slice(0, 20).map(p => '0x' + p.toString(16)).join(', ')}`);

if (positions.length >= 2) {
  // Check stride
  const strides = [];
  for (let i = 1; i < positions.length; i++) strides.push(positions[i] - positions[i-1]);
  const strideCounts = new Map();
  for (const s of strides) strideCounts.set(s, (strideCounts.get(s) || 0) + 1);
  console.log(`\nStride frequencies:`);
  [...strideCounts.entries()].sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([s, c]) => {
    console.log(`  Δ=${s} occurred ${c} times`);
  });
}

// Find first run of stride-16
let firstStrideStart = -1, strideRunLen = 0;
for (let i = 1; i < positions.length; i++) {
  if (positions[i] - positions[i-1] === 16) {
    if (firstStrideStart < 0) firstStrideStart = positions[i-1];
    strideRunLen++;
  } else {
    if (strideRunLen >= 10) break;  // good run
    firstStrideStart = -1;
    strideRunLen = 0;
  }
}
console.log(`\nFirst long stride-16 run starts at position with value-3 byte: 0x${firstStrideStart.toString(16)}`);

// So the record boundary aligns: record start = firstStrideStart - 12 (if +12 is the value=3 slot)
// or record start = firstStrideStart - 0 (if value=3 is at +0)
// Let's check both alignments
if (firstStrideStart > 0) {
  console.log(`\n=== Alignment A: record starts at 0x${(firstStrideStart - 12).toString(16)} (value=3 at +12) ===`);
  for (let i = 0; i < 4; i++) {
    const rs = firstStrideStart - 12 + i * 16;
    console.log(`  rec[${i}] @ 0x${rs.toString(16)}: ${buf.subarray(rs, rs+16).toString('hex')}`);
  }
  console.log(`=== Alignment B: record starts at 0x${firstStrideStart.toString(16)} (value=3 at +0) ===`);
  for (let i = 0; i < 4; i++) {
    const rs = firstStrideStart + i * 16;
    console.log(`  rec[${i}] @ 0x${rs.toString(16)}: ${buf.subarray(rs, rs+16).toString('hex')}`);
  }
}

// Walk the value=3 array with correct alignment (the records seem to be 16B with the "3" at +6)
// Look more carefully: position 0x1f442ee has value 3, and we have positions every 16. Let's pick the row start.
// At 0x1f442e0 we saw: ef 00 00 00 00 00 00 00 00 00 00 00 [03 00 00 00] 00 00 00 00 00 00 00 00 ... 03 00 ...
// So actual record is 16 bytes: [00*12 03 00 00 00] -- offset of "03" is at +12. So record[0] is at 0x1f442dc.
// But let's just count rows until pattern breaks.

let arrStart = firstStrideStart - 12;
let arrCount = 0;
let pp = arrStart;
while (pp + 16 <= buf.length) {
  // Check that bytes +0..+11 are zero and +12 = 03
  let ok = true;
  for (let i = 0; i < 12; i++) if (buf[pp + i] !== 0) { ok = false; break; }
  if (ok && buf[pp+12] !== 0x03) ok = false;
  if (ok && (buf[pp+13] !== 0 || buf[pp+14] !== 0 || buf[pp+15] !== 0)) ok = false;
  if (!ok) break;
  arrCount++;
  pp += 16;
}
console.log(`\n=== 16-byte records of all-zero-except-(+12=3) starting 0x${arrStart.toString(16)}: ${arrCount} ===`);
console.log(`Array ends at 0x${pp.toString(16)} (size ${pp - arrStart} bytes)`);

// Show what's just before and just after
console.log(`\n=== Bytes around array start ===`);
for (let off = arrStart - 32; off < arrStart + 32; off += 16) {
  console.log(`  0x${off.toString(16)}: ${buf.subarray(off, off + 16).toString('hex')}`);
}
console.log(`\n=== Bytes around array end ===`);
for (let off = pp - 32; off < pp + 256; off += 16) {
  console.log(`  0x${off.toString(16)}: ${buf.subarray(off, off + 16).toString('hex')}`);
}
