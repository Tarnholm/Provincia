// Session 23: hash blob #12 — there's data between 0xff padding end (0x1f43688) and high-entropy start (0x1f43898).
// Look at 0x1f43688..0x1f43898 (528 bytes).

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

console.log(`=== 0x1f43680..0x1f43900 (transition: 0xff padding end → high-entropy start) ===`);
for (let off = 0x1f43680; off < 0x1f43900; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  const sp = buf.readUInt32LE(off);
  const flag = sp === off ? ' *SELF*' : '';
  console.log(`  0x${off.toString(16)}: ${hex}  ${ascii}${flag}`);
}

// (b) Compute entropy more granularly (32-byte chunks) in 0x1f43500..0x1f44400
console.log(`\n=== Entropy per 32B chunk 0x1f43680..0x1f44400 ===`);
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
let prev = null;
for (let off = 0x1f43680; off < 0x1f44400; off += 32) {
  const H = entropy(buf.subarray(off, off + 32));
  const flag = H > 4 ? ' HIGH' : (H < 1 ? ' ZERO' : '');
  if (prev === null || (prev < 4 && H >= 4) || (prev >= 4 && H < 4)) {
    console.log(`  0x${off.toString(16)}: H=${H.toFixed(2)}${flag}`);
  }
  prev = H;
}

// (c) Look at structure 0x1f43700..0x1f437c0 — appears to have UUID-like data
console.log(`\n=== 0x1f43700..0x1f437c0 (potentially structured pre-hash zone) ===`);
for (let off = 0x1f43700; off < 0x1f437c0; off += 4) {
  const v = buf.readUInt32LE(off);
  const v2 = buf.readUInt32LE(off + 4);
  const v3 = buf.readUInt32LE(off + 8);
  const v4 = buf.readUInt32LE(off + 12);
  console.log(`  0x${off.toString(16)}: u32 ${v.toString(16).padStart(8,'0')} ${v2.toString(16).padStart(8,'0')} ${v3.toString(16).padStart(8,'0')} ${v4.toString(16).padStart(8,'0')}`);
  off += 12;
}
