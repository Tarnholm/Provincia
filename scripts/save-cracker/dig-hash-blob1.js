// Session 23: enumerate the ~19KB hash blob between field-army units end and settlement model strings.
// Session 14: bounds approx 0x1f43000..0x1f47abd (~19 KB). Session 22 confirmed field-army block ends 0x1f42cb6.
// Field-army records have 8B hash + 8B uuid; if hash blob is a lookup table, all 122 hashes should appear in it.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

const fieldArmyEnd = 0x1f42cb6;
// We need to find the actual hash blob start (zone after field army end, before settlement model strings).
// Session 14 said hash blob 0x1f43000..0x1f47abd. Let's verify boundaries.

console.log(`=== Region tail boundaries verification ===`);
console.log(`Field-army end (session 22):           0x${fieldArmyEnd.toString(16)}`);
console.log(`Session-14 hash blob start:            0x1f43000  (gap: ${0x1f43000 - fieldArmyEnd} bytes after field-army)`);
console.log(`Session-14 hash blob end:              0x1f47abd  (~${0x1f47abd - 0x1f43000} bytes)`);
console.log();

// Hex dump first 256B of presumed hash blob
console.log(`=== Hex dump 0x1f43000..0x1f43100 (start of hash blob) ===`);
for (let p = 0x1f43000; p < 0x1f43100; p += 16) {
  const slice = buf.subarray(p, p + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`0x${p.toString(16)}: ${hex}`);
}

console.log(`\n=== Hex dump 0x1f47a00..0x1f47b00 (end of hash blob / start of next region) ===`);
for (let p = 0x1f47a00; p < 0x1f47b00; p += 16) {
  const slice = buf.subarray(p, p + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`0x${p.toString(16)}: ${hex}`);
}

// Entropy per 1KB across the supposed hash region + adjacent area
console.log(`\n=== Entropy per 1KB block 0x1f42000..0x1f48000 ===`);
function entropy(slice) {
  const freq = new Uint32Array(256);
  for (const b of slice) freq[b]++;
  let H = 0;
  for (const f of freq) {
    if (f === 0) continue;
    const p = f / slice.length;
    H -= p * Math.log2(p);
  }
  return H;
}

for (let p = 0x1f42000; p < 0x1f48000; p += 1024) {
  const slice = buf.subarray(p, p + 1024);
  const H = entropy(slice);
  const flag = H > 7 ? ' HIGH-ENTROPY' : (H > 5 ? ' med' : '');
  console.log(`  0x${p.toString(16)}: H=${H.toFixed(2)}${flag}`);
}
