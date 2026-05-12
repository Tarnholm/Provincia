// Examine the 4 structural inserts in context.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_4.2.sav'));

function dump(buf, start, end, label) {
  console.log(`\n${label}: 0x${start.toString(16)}..0x${end.toString(16)} (${end-start}B)`);
  for (let p = start; p < end; p += 16) {
    const slice = buf.slice(p, Math.min(end, p+16));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' ');
    const asc = Array.from(slice).map(x => (x>=0x20 && x<0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log(`  0x${p.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} | ${asc}`);
  }
}

// Site 1: 0x1504eb9 (+32 bytes) - in B only
dump(B, 0x1504e80, 0x1504f10, 'B near 0x1504eb9 (+32 INS_B)');
dump(A, 0x1504e80, 0x1504f00, 'A near 0x1504e96 (corresponding offset)');

// Site 2: 0x1f48540 (+90 bytes) - the W_hellenistic_Large_Town insert
dump(B, 0x1f48500, 0x1f48630, 'B near 0x1f48540 (+90 INS_B with W_hellenistic_Large_Town)');
dump(A, 0x1f48500, 0x1f485a0, 'A near 0x1f4853f (corresponding offset)');

// Compare around the body-root area (0xf846b0 etc.)
// This is Roma — check what default_set body looks like in save_4.2.
const dsB = B.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1');
const hrB = B.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1');
const dsA = A.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1');
const hrA = A.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1');
console.log(`\nA (save_3.2): default_set @ 0x${dsA.toString(16)}, hinterland_region @ 0x${hrA.toString(16)}, body=${hrA-dsA-12-10}B (88B)`);
console.log(`B (save_4.2): default_set @ 0x${dsB.toString(16)}, hinterland_region @ 0x${hrB.toString(16)}, body=${hrB-dsB-12-10}B (53B)`);

// And settlement #2 (save_3.2 has the levies queue, save_4.2 has empty queue, but
// the −77 insert at f8591c is in settlement #2 region, what's there?)
dump(A, 0xf85900, 0xf85990, 'A near 0xf8591c (-77 INS_A)');
dump(B, 0xf85900, 0xf85990, 'B near 0xf8591a');
