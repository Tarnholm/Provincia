// Find vanilla Rome's event counter offset. u32@0xefd was constant=1 in
// all vanilla saves, so the actual counter is elsewhere. Hunt for u32
// values in the header that:
//   - DIFFER between peace and war
//   - The war value is GREATER than peace (events monotonically tick up)
//   - The difference is plausibly "event count" (10s to 1000s)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

// Scan first 0x5000 bytes
console.log('=== Header-zone u32 values that DIFFER between peace and war ===');
const candidates = [];
for (let i = 0; i < 0x5000; i += 4) {
  const p = peace.readUInt32LE(i);
  const w = war.readUInt32LE(i);
  if (p === w) continue;
  // Filter: both look like reasonable small-int counters or moderate values
  if (p < 0xffffffff && w < 0xffffffff && p < 0xf0000000 && w < 0xf0000000) {
    candidates.push({ off: i, peace: p, war: w, delta: w - p });
  }
}
console.log('Total differing u32 in 0..0x5000:', candidates.length);
// Filter to small/plausible counter values
const plausible = candidates.filter(c => Math.abs(c.delta) < 100000 && c.peace < 1000000 && c.war < 1000000);
console.log('Plausible counter candidates (peace,war < 1M, |delta| < 100K):', plausible.length);
plausible.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
for (const c of plausible.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ': peace=' + c.peace + ' war=' + c.war + ' Δ=' + c.delta);
}

// Also try the same scan in BIGGER zone (up to 0x20000)
console.log('\n=== Plausible counter candidates in 0..0x20000 ===');
const all = [];
for (let i = 0; i < 0x20000; i += 4) {
  const p = peace.readUInt32LE(i);
  const w = war.readUInt32LE(i);
  if (p === w) continue;
  if (p < 100000 && w < 100000 && w > p && (w - p) < 10000) {
    all.push({ off: i, peace: p, war: w, delta: w - p });
  }
}
console.log('Total plausible counters in 0..0x20000:', all.length);
all.sort((a, b) => a.delta - b.delta);
for (const c of all.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ': peace=' + c.peace + ' war=' + c.war + ' Δ=' + c.delta);
}
