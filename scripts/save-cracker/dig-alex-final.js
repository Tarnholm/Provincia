// Final comprehensive tabulation of all Alex saves.
// Use this to read every action's signature in one shot.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

// Auto-discover all sav files in the alex saves folder
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav'));

function readCounters(buf) {
  return {
    year:   buf.readInt32LE(0x504),
    evtCtr: buf.readUInt32LE(0xefd),
  };
}

const data = [];
for (const f of allFiles) {
  try {
    const buf = fs.readFileSync(path.join(BASE, f));
    const c = readCounters(buf);
    data.push({ tag: f.replace(/^save_/, '').replace(/\.sav$/, ''), size: buf.length, ...c });
  } catch (e) { /* skip */ }
}

// Sort by counter (chronological proxy)
data.sort((a, b) => a.evtCtr - b.evtCtr);

console.log('Sorted by event counter (chronological):');
console.log('evtCtr   year   size       Δ_vs_prev   filename');
let prevSize = 0;
for (const d of data) {
  const Δ = prevSize === 0 ? 0 : d.size - prevSize;
  console.log(d.evtCtr.toString().padStart(6) + '   ' + d.year.toString().padStart(5) +
              '   ' + d.size.toString().padStart(8) +
              '   ' + (Δ >= 0 ? '+' : '') + Δ.toString().padStart(7) +
              '   ' + d.tag);
  prevSize = d.size;
}

// Group by year/turn-equivalent (year=-336 → turn 1-2, year=-335 → turn 3-4, etc.)
console.log('\n=== Counter advance per action class (relative to t1 baseline counter=241) ===');
const baseline = data.find(d => d.tag.includes('Turn 1') && !d.tag.includes('besige') && !d.tag.includes('move') && !d.tag.includes('boe') && !d.tag.includes('disem') && !d.tag.includes('tax') && !d.tag.includes('attack') && !d.tag.includes('building') && !d.tag.includes('unit') && !d.tag.includes('boat') && !d.tag.includes('Turn 2'));
if (baseline) {
  console.log('Baseline (Turn 1): evtCtr=' + baseline.evtCtr);
}

// Per-action size & counter deltas from baseline
const sortedBySize = [...data].sort((a, b) => a.size - b.size);
console.log('\nSorted by size:');
for (const d of sortedBySize) {
  console.log(d.size.toString().padStart(8) + ' (' + d.evtCtr.toString().padStart(5) + ')  ' + d.tag);
}
