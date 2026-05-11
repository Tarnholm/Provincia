// Compare saveturn1start vs Noarmiesmovedturn1 — both turn 1, both 1051379+ bytes.
// Diff to find what shifts even when "nothing happens" (RNG, frame counter).
// Then compare to (saveturn1start vs saveturn2start) — across full turn boundary.

const fs = require('fs');
const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/';

const a = fs.readFileSync(dir + 'save_saveturn1start.sav');
const b = fs.readFileSync(dir + 'save_Noarmiesmovedturn1.sav');
console.log(`a (start): ${a.length}`);
console.log(`b (noarmies): ${b.length}`);

// Both same length
function diff(a, b) {
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

const regs = diff(a, b);
const totalDiff = regs.reduce((s, r) => s + r.len, 0);
console.log(`${regs.length} diff regions, total ${totalDiff} bytes`);
for (const r of regs.slice(0, 50)) {
  const ah = [...a.subarray(r.offset, r.offset + Math.min(r.len, 24))].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const bh = [...b.subarray(r.offset, r.offset + Math.min(r.len, 24))].map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  0x${r.offset.toString(16).padStart(8,'0')} len=${r.len}  A=${ah}  B=${bh}`);
}
