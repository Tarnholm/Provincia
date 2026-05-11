// notdamagedturn1 (1189090) vs damagedturn1 (1189090) — same size.
// One is pre-battle, one is post-battle (per file naming + session 11 notes).
// Diff to find the battle log fingerprint.

const fs = require('fs');
const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/';

const a = fs.readFileSync(dir + 'save_notdamagedturn1.sav');
const b = fs.readFileSync(dir + 'save_damagedturn1.sav');
console.log(`notdamaged: ${a.length}`);
console.log(`damaged:    ${b.length}`);

// Find all diff bytes
const diffs = [];
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
console.log(`Total diff bytes: ${diffs.length}`);

// Find contiguous diff regions
const regions = [];
let curStart = -1;
for (let i = 0; i < a.length; i++) {
  if (a[i] !== b[i]) {
    if (curStart < 0) curStart = i;
  } else if (curStart >= 0) {
    regions.push({ offset: curStart, len: i - curStart });
    curStart = -1;
  }
}
if (curStart >= 0) regions.push({ offset: curStart, len: a.length - curStart });
console.log(`${regions.length} contiguous diff regions`);
regions.sort((x, y) => y.len - x.len);
for (const r of regions.slice(0, 30)) {
  console.log(`  0x${r.offset.toString(16).padStart(8,'0')} len=${r.len}`);
}

// For each region, show before-after bytes:
console.log(`\nDetail of top 10 regions (before -> after):`);
for (const r of regions.slice(0, 10)) {
  const ah = [...a.subarray(r.offset, r.offset + Math.min(r.len, 32))].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const bh = [...b.subarray(r.offset, r.offset + Math.min(r.len, 32))].map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  0x${r.offset.toString(16).padStart(8,'0')} len=${r.len}`);
  console.log(`    A: ${ah}`);
  console.log(`    B: ${bh}`);
}
