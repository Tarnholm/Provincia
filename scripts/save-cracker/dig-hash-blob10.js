// Session 23: hash blob #10 — interpret the 0x1f442de "self-pointer with size=239" properly.
// Hypothesis: it's not standard {selfPtr, size} but {selfPtr, COUNT-of-records}.
// Then 239 × 16 = 3824 byte array follows.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

console.log(`=== Region 0x1f442d0..0x1f44320 (header + first records) ===`);
for (let off = 0x1f442d0; off < 0x1f44320; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`  0x${off.toString(16)}: ${hex}`);
}

console.log(`\n=== Self-pointer at 0x1f442de (interpretation) ===`);
console.log(`  +0  u32 = 0x${buf.readUInt32LE(0x1f442de).toString(16)} (self)`);
console.log(`  +4  u32 = ${buf.readUInt32LE(0x1f442e2)} (= 239 = RIS faction count!)`);
console.log(`  +8  u32 = ${buf.readUInt32LE(0x1f442e6)}`);

// So the "header" is at 0x1f442de: [u32 selfPtr=0x1f442de][u32 count=239][u32 reserved=0?]
// Then records start at 0x1f442ea? Or 0x1f442ee?
// Let's check both.

console.log(`\nIf records start at 0x1f442ea (16B from header):`);
for (let i = 0; i < 4; i++) {
  const off = 0x1f442ea + i * 16;
  const slice = buf.subarray(off, off + 16);
  console.log(`  rec[${i}] @ 0x${off.toString(16)}: ${slice.toString('hex')}`);
}

console.log(`\nIf records start at 0x1f442ee (12B from header):`);
for (let i = 0; i < 4; i++) {
  const off = 0x1f442ee + i * 16;
  const slice = buf.subarray(off, off + 16);
  console.log(`  rec[${i}] @ 0x${off.toString(16)}: ${slice.toString('hex')}`);
}

// Test: count records of 16B at each candidate start; pattern is u32=3 + 12 zeros
function countPattern(start, pattern) {
  let n = 0, p = start;
  while (p + 16 <= buf.length) {
    let ok = true;
    for (let i = 0; i < 16; i++) {
      if (pattern[i] !== null && buf[p+i] !== pattern[i]) { ok = false; break; }
    }
    if (!ok) break;
    n++; p += 16;
  }
  return { n, endOff: p };
}

const pat = [0x03, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0];
const r1 = countPattern(0x1f442ea, pat);
const r2 = countPattern(0x1f442ee, pat);
console.log(`\nPattern (u32=3, 12 zeros) records from 0x1f442ea: ${r1.n}`);
console.log(`Pattern (u32=3, 12 zeros) records from 0x1f442ee: ${r2.n}`);

// So count=239 (from header) matches if records start at 0x1f442ee and we count 238 records — except the
// LAST one (#239) has its own structure (the self-pointer at 0x1f451d6, value=1.0 at +24).
// 239th record = 0x1f442ee + 238*16 = 0x1f451ce. Confirmed.

// Now verify: does the header at 0x1f442de explain the entire structure?
// Hypothesis: [u32 selfPtr][u32 N=239][u32 reserved][N × 16B records]
// Record [0..237] = "default factionState" = {3, 0, 0, 0}
// Record [238] = "special" = has sub-structure (perhaps owner faction data)

console.log(`\n=== Record [238] at 0x1f451ce + 16B: special record ===`);
console.log(`  ${buf.subarray(0x1f451ce, 0x1f451ce + 32).toString('hex')}`);
// +12 has a self-pointer 0x1f451d6 — wait, +12 from rec[238] (0x1f451ce + 12 = 0x1f451da) is 0
// The self-ptr 0x1f451d6 is at 0x1f451ce + 8 = 0x1f451d6  ✓ matches

// Better hypothesis: records are NOT all 16B. The pattern is uniform 238 times,
// but the array has a TERMINATOR that includes a self-pointer pointing to its own location.
// Let's compute the size in bytes given the header.

// Let's now check what about the HIGH-ENTROPY 0x1f43898..0x1f441a0 zone — is there a header before it?
console.log(`\n=== Hex dump 0x1f43890..0x1f438a8 ===`);
for (let off = 0x1f43880; off < 0x1f438a8; off += 4) {
  console.log(`  0x${off.toString(16)}: ${buf.subarray(off, off + 4).toString('hex')}  u32=${buf.readUInt32LE(off)}`);
}

// Scan backward from 0x1f43898 for self-pointer
console.log(`\n=== Scan backward from 0x1f43898 for self-pointer ===`);
for (let off = 0x1f43898 - 4; off > 0x1f43500; off -= 4) {
  const sp = buf.readUInt32LE(off);
  if (sp === off) {
    const sz = buf.readUInt32LE(off + 4);
    console.log(`  Self-pointer @ 0x${off.toString(16)}: size/count=${sz}`);
    if (sz > 0 && sz < 10000) {
      const possEnd = off + 8 + sz * 8;  // if size = count of 8B records
      console.log(`    If count of 8B records: end=0x${possEnd.toString(16)}`);
      const possEnd2 = off + sz;  // if size in bytes
      console.log(`    If size in bytes: end=0x${possEnd2.toString(16)}`);
    }
  }
}

// 289 × 8 = 2312 bytes. If header is at 0x1f43890 and size in bytes = 2312 + 8 = 2320 = 0x910, end at 0x1f441a0.
// Check 0x1f43890: should be self-ptr if header

console.log(`\nCheck various positions for header structure:`);
for (const off of [0x1f43890, 0x1f43894, 0x1f4388c, 0x1f43898]) {
  const sp = buf.readUInt32LE(off);
  const sz = buf.readUInt32LE(off + 4);
  console.log(`  0x${off.toString(16)}: u32_0=0x${sp.toString(16)}, u32_4=0x${sz.toString(16)} (=${sz})`);
}
