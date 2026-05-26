// Examine the 4 hits of unit UUID e4 3d 21 89 in PRE/POST — find the unit record
const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const POST = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));

const uuid = Buffer.from([0xe4, 0x3d, 0x21, 0x89]);

function findAll(buf, m) {
  const positions = [];
  let p = 0;
  while (true) {
    const idx = buf.indexOf(m, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

const preHits = findAll(PRE, uuid);
console.log('PRE hits at:');
for (const h of preHits) console.log('  0x' + h.toString(16));

// For each hit, dump 64 bytes context (32 before, 32 after)
for (const h of preHits) {
  console.log('\n=== PRE hit @ 0x' + h.toString(16) + ' (context ±64 bytes) ===');
  for (let j = -32; j < 64; j += 16) {
    const hex = Array.from(PRE.slice(h + j, h + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(PRE.slice(h + j, h + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = (j === 0) ? '  ← UUID' : '';
    console.log('  ' + (j >= 0 ? '+' : '') + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|' + mark);
  }
}

// Same for POST
const postHits = findAll(POST, uuid);
console.log('\nPOST hits at:');
for (const h of postHits) console.log('  0x' + h.toString(16));

for (const h of postHits) {
  console.log('\n=== POST hit @ 0x' + h.toString(16) + ' (context ±64 bytes) ===');
  for (let j = -32; j < 64; j += 16) {
    const hex = Array.from(POST.slice(h + j, h + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(POST.slice(h + j, h + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = (j === 0) ? '  ← UUID' : '';
    console.log('  ' + (j >= 0 ? '+' : '') + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|' + mark);
  }
}
