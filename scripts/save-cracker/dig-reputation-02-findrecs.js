// dig-reputation-02-findrecs.js
// parseFactionTreasuries found 0 records in vanilla Spain saves. The strict
// signature (self-ptrs at +24/+40, +44==6) may not hold for vanilla. Relax
// the scan progressively to find the class-100 faction records.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

console.log('size=' + buf.length);

// Count occurrences of u32==100 at i+8 with version u32==1 at i+12.
let c100 = 0, c100v1 = 0, withSelfptr24 = 0, with44eq6 = 0;
const hits = [];
for (let i = 0; i + 96 < buf.length; i++) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  c100++;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  c100v1++;
  const sp24 = buf.readUInt32LE(i + 24) === i + 24;
  const sp40 = buf.readUInt32LE(i + 40) === i + 40;
  const n44 = buf.readUInt32LE(i + 44);
  if (sp24) withSelfptr24++;
  if (n44 === 6) with44eq6++;
  hits.push({ i, sp24, sp40, n44, treasury: buf.readInt32LE(i), z16: buf.readUInt32LE(i+16), z20: buf.readUInt32LE(i+20) });
}
console.log(`u32(i+8)==100: ${c100}`);
console.log(`  + u32(i+12)==1: ${c100v1}`);
console.log(`  + selfptr@+24: ${withSelfptr24}`);
console.log(`  + (i+44)==6: ${with44eq6}`);

console.log('\nFirst 40 (class=100, version=1) candidates:');
for (const h of hits.slice(0, 40)) {
  console.log(`  @0x${h.i.toString(16).padStart(7,'0')} treasury=${h.treasury} sp24=${h.sp24} sp40=${h.sp40} +44=${h.n44} z16=${h.z16} z20=${h.z20}`);
}
