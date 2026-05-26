// Map each default_set marker to: which settlement it belongs to, its discriminator
// bytes (-4, -3, +51), and verify the "last = active" hypothesis.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVE = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

const target = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
const allDs = [];
let p = 0;
while (true) {
  const idx = SAVE.indexOf(target, p);
  if (idx === -1) break;
  allDs.push(idx);
  p = idx + 14;
}

// Group consecutive markers by proximity (< 3000 bytes apart = same settlement)
const settlements = [];
let cur = [allDs[0]];
for (let i = 1; i < allDs.length; i++) {
  if (allDs[i] - allDs[i - 1] < 3000) {
    cur.push(allDs[i]);
  } else {
    settlements.push(cur);
    cur = [allDs[i]];
  }
}
settlements.push(cur);

console.log('Settlements (proximity-clustered): ' + settlements.length);
console.log();

for (let s = 0; s < settlements.length; s++) {
  const markers = settlements[s];
  console.log('Settlement ' + (s + 1) + ' (' + markers.length + ' lists, first @ 0x' + markers[0].toString(16) + '):');
  for (let i = 0; i < markers.length; i++) {
    const off = markers[i];
    const m4 = SAVE[off - 4];
    const m3 = SAVE[off - 3];
    const m2 = SAVE[off - 2];
    const t51 = SAVE[off + 14 + 51];
    const t55 = SAVE[off + 14 + 55];
    const isLast = (i === markers.length - 1);
    console.log('  list ' + (i + 1) + ' @ 0x' + off.toString(16) +
      '  -4=0x' + m4.toString(16).padStart(2, '0') +
      '  -3=0x' + m3.toString(16).padStart(2, '0') +
      '  -2=0x' + m2.toString(16).padStart(2, '0') +
      '  +51=' + t51 +
      '  +55=' + t55 +
      (isLast ? '  *** LAST ***' : ''));
  }
}

// Check: is +51=1 always on the LAST list of a settlement?
console.log('\n=== Hypothesis test: is +51=1 always the LAST list of its settlement? ===');
for (const markers of settlements) {
  for (let i = 0; i < markers.length; i++) {
    const flag = SAVE[markers[i] + 14 + 51];
    const isLast = (i === markers.length - 1);
    if (flag === 1 && !isLast) {
      console.log('  COUNTER-EXAMPLE: list ' + (i + 1) + '/' + markers.length + ' @ 0x' + markers[i].toString(16) + ' has +51=1 but is NOT last');
    }
    if (flag !== 1 && isLast) {
      console.log('  Last list @ 0x' + markers[i].toString(16) + ' has +51=' + flag + ' (NOT 1) — settlement has ' + markers.length + ' lists');
    }
  }
}

// Also check -4 byte mapping: does it correlate with settlement TIER?
console.log('\n=== -4 byte sequences per settlement (might track tier progression) ===');
for (const markers of settlements) {
  const seq = markers.map(off => '0x' + SAVE[off - 4].toString(16).padStart(2, '0')).join(' -> ');
  console.log('  (' + markers.length + ' lists) ' + seq);
}
