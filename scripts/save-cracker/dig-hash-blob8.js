// Session 23: hash blob #8 — confirm 239-record value=3 array and analyze the Δ=9540 jump.
// Then full map of 0x1f43500..0x1f47abd.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// Count 16B all-zero-except-(+0=3) records at alignment B
let p = 0x1f442ee;
let n = 0;
while (p + 16 <= buf.length) {
  let ok = true;
  if (buf.readUInt32LE(p) !== 3) ok = false;
  if (ok) for (let i = 4; i < 16; i++) if (buf[p+i] !== 0) { ok = false; break; }
  if (!ok) break;
  n++;
  p += 16;
}
console.log(`16B records of {u32=3, 12 zeros} starting 0x1f442ee: ${n}`);
console.log(`Array ends at 0x${p.toString(16)} (size ${p - 0x1f442ee} bytes)`);

// 23 majors + 216 minors = 239 — does this match?
console.log(`Match RIS 239 factions hypothesis? ${n === 239 ? 'YES' : 'NO'}`);

// Show what's just after the array
console.log(`\n=== Hex dump at array end + 64B ===`);
for (let off = p; off < p + 256; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`  0x${off.toString(16)}: ${hex}`);
}

// Continue: scan for next structured region
console.log(`\n=== Continue search: what follows 0x${p.toString(16)}? ===`);
// Show entropy 256B-chunk by 256B-chunk from p to 0x1f47abd
function entropy(slice) {
  const freq = new Uint32Array(256);
  for (const b of slice) freq[b]++;
  let H = 0;
  for (const f of freq) {
    if (f === 0) continue;
    const pp = f / slice.length;
    H -= pp * Math.log2(pp);
  }
  return H;
}
let prevH = null;
for (let off = p; off < 0x1f47b00; off += 256) {
  const H = entropy(buf.subarray(off, Math.min(off + 256, buf.length)));
  const flag = H > 7 ? ' HIGH' : (H > 5 ? ' med' : '');
  if (prevH === null || Math.abs(H - prevH) > 0.5) {
    console.log(`  0x${off.toString(16)}: H=${H.toFixed(2)}${flag}`);
    prevH = H;
  }
}

// Map all 03 00 00 00 u32 positions in 0x1f44000..0x1f47abd to find the "stride 9540" pattern
const pos3 = [];
for (let off = 0x1f44000; off < 0x1f47abd; off++) {
  if (buf.readUInt32LE(off) === 3 && (off - 0x1f44000) % 16 < 16) {
    pos3.push(off);
  }
}
// (this picks up all aligned-or-not value=3 positions)
console.log(`\nu32=3 positions in 0x1f44000..0x1f47abd: ${pos3.length}`);
console.log(`First 4: ${pos3.slice(0, 4).map(p => '0x' + p.toString(16)).join(', ')}`);
console.log(`Last 4: ${pos3.slice(-4).map(p => '0x' + p.toString(16)).join(', ')}`);

// Check: after the array (0x1f4 + 239*16 = 0x1f442ee + 3824 = 0x1f441de  wait...
// arrayEnd should be 0x1f442ee + 239*16 = 0x1f442ee + 0xef0 = 0x1f441de? That's BEFORE arrayStart!
// Let me recompute
const arrayEnd = 0x1f442ee + 239 * 16;
console.log(`\nExpected array end (if 239 records, 16B each): 0x${arrayEnd.toString(16)}`);

// Compare with actual end
console.log(`Actual count n=${n}, end=0x${p.toString(16)}`);

// Dump just before and after the expected end
const expectedEnd = 0x1f442ee + n * 16;
console.log(`\n=== Hex dump around expected end 0x${expectedEnd.toString(16)} ===`);
for (let off = expectedEnd - 32; off < expectedEnd + 256; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log(`  0x${off.toString(16)}: ${hex}  ${ascii}`);
}
