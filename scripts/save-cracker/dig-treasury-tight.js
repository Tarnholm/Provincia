// Tighter treasury hunt — Spain's treasury should be in 1000-30000 at T1,
// and similar at T4 (after 4 turns of income/upkeep). Plus stable within
// same-turn saves.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const SAVES = [];
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const year = buf.readInt32LE(0x514);
  SAVES.push({ name: f, buf, year, size: buf.length });
}
SAVES.sort((a, b) => a.size - b.size);  // sort by file size (turn proxy — later turns have bigger files)

console.log('save'.padEnd(60) + ' year size');
for (const s of SAVES) console.log(s.name.padEnd(60) + ' ' + s.year + ' ' + s.size);

// Find u32 positions where:
//   - All values across saves are in [1000..50000] (treasury range)
//   - Values are different between saves (treasury changes over time)
const len = Math.min(...SAVES.map(s => s.buf.length));
const candidates = [];
for (let off = 0; off < 0x10000; off += 4) {
  if (off + 4 > len) break;
  const vals = SAVES.map(s => s.buf.readInt32LE(off));
  if (vals.some(v => v < 1000 || v > 50000)) continue;
  // Must vary
  if (new Set(vals).size === 1) continue;
  candidates.push({ off, vals });
}
console.log('\n=== Treasury candidates (all values in 1000..50000, varying) ===');
console.log('Total candidates:', candidates.length);

// Sort by spread (max - min)
candidates.sort((a, b) => (Math.max(...a.vals) - Math.min(...a.vals)) - (Math.max(...b.vals) - Math.min(...b.vals)));
console.log('\nTop 20 with smallest spreads (most plausible treasury):');
for (const c of candidates.slice(0, 20)) {
  console.log('  u32@0x' + c.off.toString(16) + ': [' + c.vals.join(', ') + ']');
}
console.log('\nTop 20 with biggest spreads (might be event counters or position):');
for (const c of candidates.slice(-20)) {
  console.log('  u32@0x' + c.off.toString(16) + ': [' + c.vals.join(', ') + ']');
}
