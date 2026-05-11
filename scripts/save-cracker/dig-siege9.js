// dig-siege9.js
// CORRECTED siege block layout (verified from raw bytes at 0x152f529 in save_8):
//   off 0:    01 (siege flag)
//   off 1..12: 12-byte UUID
//   off 13..65: 53 zero bytes
//   off 66..67: u16 little-endian (2261 = 0x08d5)  — could be strength/HP/progress
//   off 68..72: 5 more zero bytes (total block 73 bytes including this tail)
// Block total = ~73 bytes (matches the +73 / -73 net delta!)

const fs = require('fs');
const path = require('path');
const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

const FILES = ['save_1.1.sav','save_2.1.sav','save_3.1.sav','save_4.1.sav','save_5.1.sav','save_6.1.sav','save_7.1.sav','save_8.1.sav','save_9.1.sav'];
const bufs = Object.fromEntries(FILES.map(f => [f, fs.readFileSync(path.join(SAVES_DIR,f))]));

// Predicate: matches save_8 siege block at 0x152f529
function isSiegeLike(buf, off) {
  if (off + 73 > buf.length) return false;
  if (buf[off] !== 0x01) return false;
  // UUID at +1..+12: ≥8 of 12 bytes non-zero
  let nz = 0;
  for (let k = 1; k <= 12; k++) if (buf[off+k] !== 0) nz++;
  if (nz < 8) return false;
  // zeros at +13..+65 (53 bytes)
  for (let k = 13; k < 66; k++) if (buf[off+k] !== 0) return false;
  // u16 at +66: small positive
  const v = buf.readUInt16LE(off+66);
  if (v === 0 || v > 0xffff) return false;
  // u16 needs to be in a "siege strength" range, say 100..30000
  if (v < 100 || v > 30000) return false;
  // bytes at +68..+72 should be zero
  for (let k = 68; k < 73; k++) if (buf[off+k] !== 0) return false;
  return true;
}

function scan(buf) {
  const hits=[];
  for (let off = 0; off + 73 <= buf.length; off++) {
    if (isSiegeLike(buf, off)) hits.push(off);
  }
  return hits;
}

for (const f of FILES) {
  const h = scan(bufs[f]);
  console.log(`${f}: ${h.length} siege-like blocks`);
  for (const o of h) {
    const uuid = bufs[f].slice(o+1, o+13).toString('hex');
    const v = bufs[f].readUInt16LE(o+66);
    console.log(`  0x${o.toString(16)}  uuid=${uuid}  +66 u16=${v}`);
  }
}
