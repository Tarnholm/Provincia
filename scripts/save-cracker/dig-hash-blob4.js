// Session 23: hash blob #4 — pin exact boundaries of the high-entropy region and what surrounds it.
// (a) Walk from 0x1f43598 (end of last soldier rec) to 0x1f47abd (settlement_model strings start)
//     and partition by entropy / pattern. The 0xff padding likely runs to ~0x1f43688, then high-entropy
//     block, then back to structure.
// (b) Cross-reference high-entropy region with field-army hashes & UUIDs.
// (c) Look for ASCII strings, UTF-16LE labels, structural markers in the gap.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// Find end of 0xff padding after last soldier rec
let p = 0x1f43598;
while (p < buf.length && buf[p] === 0xff) p++;
console.log(`End of 0xff padding (after soldier records): 0x${p.toString(16)}`);

// What's right after the padding?
const afterPad = p;
console.log(`Bytes 0x${afterPad.toString(16)}..0x${(afterPad + 32).toString(16)}: ${buf.subarray(afterPad, afterPad + 32).toString('hex')}`);

// Walk further. Show entropy in 256-byte chunks from afterPad to 0x1f47b00.
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

console.log(`\n=== Entropy per 256B chunk 0x${afterPad.toString(16)}..0x1f47b00 ===`);
let highStart = -1, highEnd = -1;
let inHigh = false;
for (let off = afterPad; off < 0x1f47b00; off += 256) {
  const H = entropy(buf.subarray(off, Math.min(off + 256, buf.length)));
  const flag = H > 7 ? ' HIGH' : (H > 5 ? ' med' : '');
  // Only print transitions
  if (H > 7 && !inHigh) { highStart = off; inHigh = true; console.log(`  0x${off.toString(16)}: H=${H.toFixed(2)}${flag}  <-- enter high-entropy`); }
  else if (H <= 7 && inHigh) { highEnd = off; inHigh = false; console.log(`  0x${off.toString(16)}: H=${H.toFixed(2)}${flag}  <-- exit high-entropy`); }
}

console.log(`\nFirst high-entropy region: 0x${highStart.toString(16)}..0x${highEnd.toString(16)} (~${highEnd - highStart} bytes)`);

// Now cross-reference the high-entropy 0x1f43800..0x1f44400 with field-army hashes
const tailStart = 0x1f10c72;
const fieldArmyAsciiEnd = 0x1f42cb6;  // session 22 said this is end of last ASCII name "armen"

const records = [];
for (let pp = tailStart; pp + 2 < fieldArmyAsciiEnd + 100; pp++) {
  const len = buf.readUInt16LE(pp);
  if (len < 4 || len > 50) continue;
  if (pp + 2 + len > buf.length) continue;
  const s = buf.slice(pp + 2, pp + 2 + len).toString('ascii');
  if (!/^[a-z][a-z ]+[a-z]\0?$/.test(s)) continue;
  records.push({ off: pp, len, name: s.replace(/\0$/, '') });
}
console.log(`\nDetected ${records.length} unit records (including past 0x1f42cb6).`);

// Collect hashes (8B after 0xee marker)
const hashes = [];
const uuids = [];
for (const r of records) {
  const after = r.off + 2 + r.len;
  if (buf[after] !== 0xee) continue;
  hashes.push({ name: r.name, off: after + 1, bytes: buf.subarray(after + 1, after + 9) });
  uuids.push({ name: r.name, off: after + 9, bytes: buf.subarray(after + 9, after + 17) });
}

// Search high-entropy zone
const searchStart = highStart > 0 ? highStart : 0x1f43800;
const searchEnd = highEnd > 0 ? highEnd : 0x1f44400;
let hashMatch = 0, uuidMatch = 0;
const matched = [];

for (const h of hashes) {
  for (let pp = searchStart; pp < searchEnd - 8; pp++) {
    let ok = true;
    for (let j = 0; j < 8; j++) if (buf[pp + j] !== h.bytes[j]) { ok = false; break; }
    if (ok) {
      hashMatch++;
      matched.push({ kind: 'hash', name: h.name, blobOff: pp });
      break;
    }
  }
}
for (const u of uuids) {
  for (let pp = searchStart; pp < searchEnd - 8; pp++) {
    let ok = true;
    for (let j = 0; j < 8; j++) if (buf[pp + j] !== u.bytes[j]) { ok = false; break; }
    if (ok) {
      uuidMatch++;
      matched.push({ kind: 'uuid', name: u.name, blobOff: pp });
      break;
    }
  }
}
console.log(`\nHash matches in 0x${searchStart.toString(16)}..0x${searchEnd.toString(16)}: ${hashMatch}/${hashes.length}`);
console.log(`UUID matches in 0x${searchStart.toString(16)}..0x${searchEnd.toString(16)}: ${uuidMatch}/${uuids.length}`);

// Scan the full 0x1f43000..0x1f47abd range for ASCII strings (>= 4 chars)
console.log(`\n=== ASCII strings (>=4 chars) in 0x1f43500..0x1f47b00 ===`);
let cur = '';
let curStart = -1;
for (let pp = 0x1f43500; pp < 0x1f47b00; pp++) {
  const b = buf[pp];
  if (b >= 0x20 && b < 0x7f) {
    if (cur === '') curStart = pp;
    cur += String.fromCharCode(b);
  } else {
    if (cur.length >= 4) console.log(`  0x${curStart.toString(16)}: '${cur}'`);
    cur = '';
  }
}
if (cur.length >= 4) console.log(`  0x${curStart.toString(16)}: '${cur}'`);

// Show dump just past the high-entropy zone - what structure follows?
console.log(`\n=== Dump 0x1f44100..0x1f44500 (around end of high-entropy) ===`);
for (let off = 0x1f44100; off < 0x1f44500; off += 32) {
  const slice = buf.subarray(off, off + 32);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`  0x${off.toString(16)}: ${hex}`);
}
