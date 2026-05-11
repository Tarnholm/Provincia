// dig-siege3.js
// We confirmed save_8 → save_9 deletes 69+4 = 73 bytes.
// The 69-byte deleted block in save_8 is at 0x152f529 — show context.
// The 4-byte deleted block in save_8 is at 0x12d8724 — show context.
// Then locate analogous +73 inserts in save_7 vs save_6 by looking for
// the same byte patterns.

const fs = require('fs');
const path = require('path');

const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_6.1.sav','save_7.1.sav','save_8.1.sav','save_9.1.sav'];
const bufs = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(SAVES_DIR, f))]));

function hex(buf, off, n=64) {
  const s=[];
  for (let i=0;i<n && off+i<buf.length;i++){
    s.push(buf[off+i].toString(16).padStart(2,'0'));
    if ((i+1)%16===0) s.push('\n');
  }
  return s.join(' ');
}
function ascii(buf, off, n=64) {
  let s='';
  for (let i=0;i<n && off+i<buf.length;i++){ const b=buf[off+i]; s+=(b>=32 && b<127)?String.fromCharCode(b):'.'; }
  return s;
}

console.log('=== save_8 has Tarentum siege; save_9 doesn\'t. ===');
console.log('\n--- 69-byte block deleted from save_8 around 0x152f529, with 64B context before/after ---');
console.log('CONTEXT BEFORE (save_8 @ 0x152f4e9 .. 0x152f529):');
console.log(hex(bufs['save_8.1.sav'], 0x152f4e9, 64));
console.log('  ASCII: ', ascii(bufs['save_8.1.sav'], 0x152f4e9, 64));
console.log('DELETED 69-BYTE BLOCK (save_8 @ 0x152f529 .. 0x152f56e):');
console.log(hex(bufs['save_8.1.sav'], 0x152f529, 80));
console.log('  ASCII: ', ascii(bufs['save_8.1.sav'], 0x152f529, 80));
console.log('CONTEXT AFTER (save_8 @ 0x152f56e .. 0x152f5ae):');
console.log(hex(bufs['save_8.1.sav'], 0x152f56e, 64));
console.log('  ASCII: ', ascii(bufs['save_8.1.sav'], 0x152f56e, 64));

console.log('\n--- 4-byte block deleted from save_8 around 0x12d8724, with 64B context ---');
console.log('CONTEXT (save_8 @ 0x12d86e4 .. 0x12d8764):');
console.log(hex(bufs['save_8.1.sav'], 0x12d86e4, 128));
console.log('  ASCII: ', ascii(bufs['save_8.1.sav'], 0x12d86e4, 128));

// Now find the corresponding location in save_9 - it should be the same content minus the 73 bytes
// Bytes before 0x12d8724 are identical, so the same context exists in save_9
console.log('\n--- Same region in save_9 (where siege block was) ---');
console.log('CONTEXT (save_9 @ 0x12d86e4 .. 0x12d8764):');
console.log(hex(bufs['save_9.1.sav'], 0x12d86e4, 128));
console.log('  ASCII: ', ascii(bufs['save_9.1.sav'], 0x12d86e4, 128));

console.log('\n=== Now: search for the same "siege block" patterns in save_7 / save_6 to find Brundisium siege ===');

// Pattern 1: the 69-byte block starts with "01 70 93 a6 7b e0 0e 7f 3d eb 2a c9 95"
// That looks like a 13-byte unique header. Let's find it.
const HEADER1 = Buffer.from([0x01,0x70,0x93,0xa6,0x7b,0xe0,0x0e,0x7f,0x3d,0xeb,0x2a,0xc9,0x95]);

function findAll(buf, pattern) {
  const hits=[];
  let i=0;
  while (i + pattern.length <= buf.length) {
    const idx = buf.indexOf(pattern, i);
    if (idx < 0) break;
    hits.push(idx);
    i = idx + 1;
    if (hits.length > 20) break;
  }
  return hits;
}

for (const f of files) {
  const hits = findAll(bufs[f], HEADER1);
  console.log(`  ${f}: pattern ${HEADER1.toString('hex')} found at ${hits.map(h=>'0x'+h.toString(16)).join(', ') || '(none)'}`);
}

// Also try the shorter "70 93 a6 7b" which appears in BOTH deletes (pointer reference)
const HEADER2 = Buffer.from([0x70,0x93,0xa6,0x7b]);
console.log('\n--- Looking for "70 93 a6 7b" (UUID short ref) in each save ---');
for (const f of files) {
  const hits = findAll(bufs[f], HEADER2);
  console.log(`  ${f}: found at ${hits.map(h=>'0x'+h.toString(16)).join(', ') || '(none)'}  (count: ${hits.length})`);
}

// And the 5-byte form "93 a6 7b 05" (matches the 4-byte delete except prefix=70)
const HEADER3 = Buffer.from([0x93,0xa6,0x7b,0x05]);
console.log('\n--- Looking for "93 a6 7b 05" in each save ---');
for (const f of files) {
  const hits = findAll(bufs[f], HEADER3);
  console.log(`  ${f}: found at ${hits.map(h=>'0x'+h.toString(16)).join(', ') || '(none)'}  (count: ${hits.length})`);
}
