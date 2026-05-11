// dig-siege8.js
// Refined: actual save_8 siege block has u32 (`d5 08 00 00`) at offset +54
// from the start of the 01-flag byte.
// Structure (69 contiguous bytes at 0x152f529 in save_8):
//   off 0:    01 (siege flag)
//   off 1-12: 12-byte UUID
//   off 13-53: 41 zero bytes
//   off 54-57: u32 (`d5 08 00 00` = 2261 — siege progress/strength?)
//   off 58-68: 11 zero bytes
// So scanner predicate is:
//   buf[X]==1; buf[X+13..X+54)==0 (41 zeros); u32(X+54) is some small >0;
//   buf[X+58..X+69)==0.
// Plus we need to be loose since uuid is random.

const fs = require('fs');
const path = require('path');
const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const s6 = fs.readFileSync(path.join(SAVES_DIR,'save_6.1.sav'));
const s7 = fs.readFileSync(path.join(SAVES_DIR,'save_7.1.sav'));
const s8 = fs.readFileSync(path.join(SAVES_DIR,'save_8.1.sav'));
const s9 = fs.readFileSync(path.join(SAVES_DIR,'save_9.1.sav'));

function isSiegeLike(buf, off) {
  if (off + 69 > buf.length) return false;
  if (buf[off] !== 0x01) return false;
  // bytes 1..12 (UUID): require at least 8 of 12 to be non-zero (random UUID)
  let nonZero = 0;
  for (let k = 1; k <= 12; k++) if (buf[off+k] !== 0) nonZero++;
  if (nonZero < 8) return false;
  // bytes 13..53 (41 zeros)
  for (let k = 13; k < 54; k++) if (buf[off+k] !== 0) return false;
  // u32 at +54: must be 1..65535
  const trail = buf.readUInt32LE(off+54);
  if (trail === 0 || trail > 0xffff) return false;
  // bytes 58..68 zeros
  for (let k = 58; k < 69; k++) if (buf[off+k] !== 0) return false;
  return true;
}

function scan(buf) {
  const hits=[];
  for (let off = 0; off + 69 <= buf.length; off++) {
    if (isSiegeLike(buf, off)) hits.push(off);
  }
  return hits;
}

const h6 = scan(s6), h7 = scan(s7), h8 = scan(s8), h9 = scan(s9);
console.log('Siege-like blocks per save:');
for (const [l, b, h] of [['s6',s6,h6],['s7',s7,h7],['s8',s8,h8],['s9',s9,h9]]) {
  console.log(`  ${l}: ${h.length} hits`);
  for (const o of h.slice(0,5)) {
    const uuid = b.slice(o+1, o+13).toString('hex');
    const trail = b.readUInt32LE(o+54);
    console.log(`    0x${o.toString(16)}  uuid=${uuid}  trail=${trail}`);
  }
}

// UUIDs unique to save_7 vs save_6: should be the Brundisium siege block
const uuidSet = (buf, hits) => new Set(hits.map(o => buf.slice(o+1,o+13).toString('hex')));
const u6=uuidSet(s6,h6), u7=uuidSet(s7,h7), u8=uuidSet(s8,h8), u9=uuidSet(s9,h9);
console.log('\nUnique to save_7 (Brundisium siege created):');
for (const u of u7) if (!u6.has(u)) console.log('  ' + u);
console.log('Unique to save_8 (Tarentum siege created on top of Brundisium):');
for (const u of u8) if (!u7.has(u)) console.log('  ' + u);
console.log('Removed in save_9 (siege ended):');
for (const u of u8) if (!u9.has(u)) console.log('  ' + u);

// For each save's hits, print full context around the block
function dumpCtx(buf, off, label) {
  console.log(`\n=== ${label} block @ 0x${off.toString(16)} (full 73 bytes) ===`);
  let hex=''; for(let k=0;k<73;k++){hex+=buf[off+k].toString(16).padStart(2,'0')+' '; if((k+1)%16===0)hex+='\n';}
  console.log(hex);
  console.log('128B after:');
  let h2=''; for(let k=73;k<73+128;k++){h2+=buf[off+k].toString(16).padStart(2,'0')+' '; if(((k-73)+1)%16===0)h2+='\n';}
  console.log(h2);
  let asc=''; for(let k=73;k<73+256;k++){const b=buf[off+k]; asc+=(b>=32&&b<127)?String.fromCharCode(b):'.';}
  console.log('ASCII after: '+asc);
}

if (h7.length>0 && h6.length===0) {
  // Brundisium siege is the only block in save_7
  for (const o of h7) dumpCtx(s7, o, 'save_7 Brundisium siege');
}
if (h8.length>0) {
  for (const o of h8) dumpCtx(s8, o, 'save_8 siege');
}
