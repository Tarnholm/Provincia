// Content-based search: vanilla Spain starts with KNOWN treasury values.
// Search for those values directly in the T1 save.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const t1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

// Vanilla starting treasuries (270 BC):
//   romans_julii: 5000
//   romans_brutii: 5000
//   romans_scipii: 5000
//   romans_senate: 20000
//   egypt: 10000  (rich)
//   seleucid: 10000
//   carthage: 8000
//   spain: 5000
//   etc.
// In vanilla descr_strat.txt the actual values vary but are typically 5000-20000

console.log('Searching T1 save for plausible starting treasury values...');
console.log('Save size: ' + t1.length);

// Search the entire file for u32 values that match common treasury amounts
const TARGETS = [5000, 6000, 7000, 8000, 10000, 12000, 15000, 20000, 25000];

function findU32(buf, value, range) {
  const hits = [];
  const target = Buffer.alloc(4);
  target.writeUInt32LE(value, 0);
  let p = range[0];
  while ((p = buf.indexOf(target, p)) !== -1 && p < range[1]) {
    hits.push(p);
    p++;
  }
  return hits;
}

console.log('\n=== u32 hits in 0x100..0x90000 ===');
for (const t of TARGETS) {
  const hits = findU32(t1, t, [0x100, 0x90000]);
  if (hits.length > 0) {
    console.log('  ' + t + ': ' + hits.length + ' hits at ' + hits.slice(0, 10).map(h => '0x' + h.toString(16)).join(', '));
  }
}

// Also try slightly less common values
console.log('\n=== Additional candidates 4000-25000 step 1000 ===');
for (let v = 4000; v <= 25000; v += 500) {
  const hits = findU32(t1, v, [0x100, 0x90000]);
  if (hits.length === 1) {  // EXACTLY ONE hit = very interesting (unique value)
    console.log('  ' + v + ': UNIQUE hit at 0x' + hits[0].toString(16));
  }
}

// And try i16/u16 since treasury could fit in 16 bits
console.log('\n=== u16 hits in 0x100..0x90000 ===');
function findU16(buf, value, range) {
  const hits = [];
  const target = Buffer.alloc(2);
  target.writeUInt16LE(value, 0);
  let p = range[0];
  while ((p = buf.indexOf(target, p)) !== -1 && p < range[1]) {
    hits.push(p);
    p += 1;
  }
  return hits;
}
for (const t of TARGETS) {
  const hits = findU16(t1, t, [0x100, 0x90000]);
  if (hits.length > 0 && hits.length < 20) {
    console.log('  ' + t + ' (u16): ' + hits.length + ' hits at ' + hits.slice(0, 10).map(h => '0x' + h.toString(16)).join(', '));
  }
}
