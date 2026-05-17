// Look for u32 pointers in the early file (header) that vary across turns
// and point to a plausible file location. Such pointers might LOCATE
// the faction record (which contains treasury).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav'));

const turnSaves = {};
for (const f of allFiles) {
  const m = f.match(/Turn (\d+)/);
  if (!m) continue;
  const t = parseInt(m[1]);
  const buf = fs.readFileSync(path.join(BASE, f));
  if (!turnSaves[t] || buf.length < turnSaves[t].buf.length) {
    turnSaves[t] = { name: f, buf };
  }
}
const turns = Object.keys(turnSaves).map(Number).sort((a, b) => a - b);

console.log('Turns analyzed: ' + turns.join(', '));
console.log('File sizes:');
for (const t of turns) console.log('  T' + t + ': ' + turnSaves[t].buf.length);

// Find u32 pointers in 0x100..0x2000 that point INTO valid file offsets
console.log('\n=== u32 pointers in 0x100..0x2000 that grow monotonically (= track growing section) ===');
const candidates = [];
for (let off = 0x100; off < 0x2000; off += 4) {
  const vals = turns.map(t => turnSaves[t].buf.readUInt32LE(off));
  // All values must be plausible file offsets (in the file size range)
  if (vals.some((v, i) => v < 0x10000 || v > turnSaves[turns[i]].buf.length)) continue;
  // Skip if constant
  if (new Set(vals).size < 3) continue;
  // Monotonic increase (section grows)
  let inc = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > vals[i-1]) inc++;
    else if (vals[i] === vals[i-1]) inc += 0.5;
  }
  if (inc < (vals.length - 1) * 0.7) continue;
  candidates.push({ off, vals });
}
console.log('Found ' + candidates.length + ' candidate pointers');
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ': ' + c.vals.map(v => '0x' + v.toString(16)).join(', '));
}

// Also check sizes vs file sizes — pointers that scale with file size
// might point to end-of-something
console.log('\n=== Pointers that scale linearly with file size ===');
for (const c of candidates.slice(0, 50)) {
  const ratios = c.vals.map((v, i) => v / turnSaves[turns[i]].buf.length);
  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((a, b) => a + (b - avgRatio) ** 2, 0) / ratios.length;
  const stddev = Math.sqrt(variance);
  if (stddev < 0.05) {
    console.log('  u32@0x' + c.off.toString(16) + ' (avgRatio=' + avgRatio.toFixed(3) + ', stddev=' + stddev.toFixed(4) + '):');
    for (let i = 0; i < c.vals.length; i++) {
      console.log('    T' + turns[i] + ' ptr=0x' + c.vals[i].toString(16) + ' (' + (c.vals[i] / turnSaves[turns[i]].buf.length * 100).toFixed(1) + '% of file)');
    }
  }
}
