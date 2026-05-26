// For each default_set marker, dump 16 bytes BEFORE the marker and 16 bytes
// AFTER (within the trailer). Tabulate which bytes vary and which are constant.

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

// Dump 8 bytes before + the trailer's first 12 bytes (after the pstr16) for each marker
console.log('All ' + allDs.length + ' default_set markers — bytes BEFORE then AFTER pstr16:');
console.log('off       | -8..-1 (before)          | trailer +0..+11');
for (const off of allDs) {
  const before = Array.from(SAVE.slice(off - 8, off)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const after = Array.from(SAVE.slice(off + 14, off + 14 + 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('0x' + off.toString(16).padStart(6) + ' | ' + before + '  | ' + after);
}

// Tabulate variability at each position relative to the marker
console.log('\n=== Per-position variability (bytes -16 to +75 relative to marker start) ===');
for (let pos = -16; pos <= 75; pos++) {
  const vals = new Set();
  for (const off of allDs) {
    if (off + pos < 0 || off + pos >= SAVE.length) continue;
    vals.add(SAVE[off + pos]);
  }
  if (vals.size === 1) continue; // constant — skip
  if (vals.size === allDs.length) {
    console.log('  pos ' + pos.toString().padStart(3) + ': ALL DIFFERENT (' + vals.size + ' unique)');
  } else if (vals.size <= 8) {
    const sortedVals = [...vals].sort((a, b) => a - b).map(v => '0x' + v.toString(16));
    console.log('  pos ' + pos.toString().padStart(3) + ': ' + vals.size + ' unique values: ' + sortedVals.join(', '));
  }
}

// Now look at bytes that have only 2-3 distinct values — those are likely FLAG bytes
console.log('\n=== Bytes with 2-4 unique values (likely flag/enum) — show distribution ===');
for (let pos = -16; pos <= 75; pos++) {
  const valCounts = {};
  for (const off of allDs) {
    if (off + pos < 0 || off + pos >= SAVE.length) continue;
    const v = SAVE[off + pos];
    valCounts[v] = (valCounts[v] || 0) + 1;
  }
  const uniqueCount = Object.keys(valCounts).length;
  if (uniqueCount < 2 || uniqueCount > 4) continue;
  const dist = Object.entries(valCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([v, c]) => '0x' + parseInt(v).toString(16) + 'x' + c).join(', ');
  console.log('  pos ' + pos.toString().padStart(3) + ': ' + dist);
}
