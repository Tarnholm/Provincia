// damagedturn1 -> damagedturn2 spans an autoresolved battle (named for the
// building damage that resulted). Diff for NEW content — the regions where
// damagedturn2 has bytes that damagedturn1 has nothing/zero. A battle-log
// entry would APPEAR as new bytes.

const fs = require('fs');
const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/';

const a = fs.readFileSync(dir + 'save_damagedturn1.sav');
const b = fs.readFileSync(dir + 'save_damagedturn2.sav');
console.log(`damagedturn1: ${a.length}`);
console.log(`damagedturn2: ${b.length}`);
console.log(`diff: ${b.length - a.length} bytes (B is larger)`);

// Naive diff: where do they start differing, by linear position?
const minLen = Math.min(a.length, b.length);
let firstDiff = -1;
for (let i = 0; i < minLen; i++) if (a[i] !== b[i]) { firstDiff = i; break; }
console.log(`First diff at: 0x${firstDiff.toString(16)} (${firstDiff})`);

let lastSameRun = 0;
// Find longest matching prefix and longest matching suffix
let prefix = 0;
while (prefix < minLen && a[prefix] === b[prefix]) prefix++;
let suffix = 0;
while (suffix < minLen && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
console.log(`Common prefix: ${prefix} bytes (0..0x${prefix.toString(16)})`);
console.log(`Common suffix: ${suffix} bytes (last ${suffix} bytes match)`);
console.log(`A middle: [0x${prefix.toString(16)}, 0x${(a.length-suffix).toString(16)}] = ${a.length - suffix - prefix} bytes`);
console.log(`B middle: [0x${prefix.toString(16)}, 0x${(b.length-suffix).toString(16)}] = ${b.length - suffix - prefix} bytes`);

// Show what's in the "B-only" inserted region (if any clean insertion):
// The middle could be insert/delete/replace. Look at what's in B's middle that's
// NOT in A's middle.

// Total contiguous diff regions, then sort by size:
function diffRegions(a, b) {
  const len = Math.min(a.length, b.length);
  const regions = [];
  let curStart = -1;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      if (curStart < 0) curStart = i;
    } else if (curStart >= 0) {
      regions.push({ offset: curStart, len: i - curStart });
      curStart = -1;
    }
  }
  if (curStart >= 0) regions.push({ offset: curStart, len: len - curStart });
  return regions;
}
const regs = diffRegions(a, b);
console.log(`\n${regs.length} contiguous diff regions in common prefix:`);
// Print regions ordered by length:
regs.sort((x, y) => y.len - x.len);
for (const r of regs.slice(0, 20)) {
  console.log(`  0x${r.offset.toString(16).padStart(8,'0')} len=${r.len}`);
}
