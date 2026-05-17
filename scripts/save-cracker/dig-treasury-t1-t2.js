// Treasury experiment: vanilla Spain T1 → T2 (just end-turn)
// Spain's income is ~1927/turn. Treasury should increase by ~1927 (or
// less after upkeep). Find a u32 that changed by approximately this amount.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

// T1 = Spain Turn 1.sav (clean)
// T2 = Spain Turn 2 trade offer to carthage, accepted.sav (after end-turn)
const T1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

console.log('T1: ' + T1.length);
console.log('T2: ' + T2.length);
console.log('Δ:  ' + (T2.length - T1.length));

// Spain's expected treasury behavior:
//   T1 starting = 3000 (per descr_strat)
//   T1 → T2 (after end-turn 1): treasury += income - upkeep - any spending
//   Spain income ~1927/turn, upkeep maybe 300-600 → net gain ~1300-1600
//   Plus user accepted a trade offer (which may add some money)
// Expected T2 treasury: 3000 + ~1500 = ~4500-5500

const EXPECTED_DELTA_LOW = 500;
const EXPECTED_DELTA_HIGH = 5000;

// Find u32 fields at the SAME OFFSET in both T1 and T2 where:
//   T1 value is in plausible treasury range (1000-15000)
//   T2 value is T1 value + 500..5000 (reasonable income gain)
// AND the offset is in a stable file zone (early, before file growth)

const len = Math.min(T1.length, T2.length);
const candidates = [];

console.log('\nScanning for u32 fields with plausible treasury growth (T2 = T1 + 500..5000)...');
for (let off = 0x100; off < 0x40000; off += 4) {
  const t1v = T1.readInt32LE(off);
  const t2v = T2.readInt32LE(off);
  if (t1v < 1000 || t1v > 30000) continue;
  if (t2v < 1000 || t2v > 30000) continue;
  const delta = t2v - t1v;
  if (delta < EXPECTED_DELTA_LOW || delta > EXPECTED_DELTA_HIGH) continue;
  // Skip fixed-point (multiples of 256)
  if (t1v % 256 === 0 && t2v % 256 === 0) continue;
  candidates.push({ off, t1v, t2v, delta });
}
console.log('Found ' + candidates.length + ' candidates');

// Sort by smallest delta (treasury would gain ~income, not huge)
candidates.sort((a, b) => Math.abs(a.delta - 1500) - Math.abs(b.delta - 1500));

console.log('\nTop 30 candidates sorted by proximity to expected ~1500 gain:');
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ': T1=' + c.t1v + ' T2=' + c.t2v + ' Δ=+' + c.delta);
}

// Bonus: also try byte-aligned (off += 1)
console.log('\n=== Byte-aligned scan (tighter range, looking for treasury) ===');
const byteCands = [];
for (let off = 0x100; off < 0x40000; off += 1) {
  const t1v = T1.readUInt32LE(off);
  const t2v = T2.readUInt32LE(off);
  if (t1v < 2500 || t1v > 8000) continue;
  if (t2v < 2500 || t2v > 8000) continue;
  const delta = t2v - t1v;
  if (delta < 500 || delta > 3000) continue;
  if (t1v % 256 === 0 && t2v % 256 === 0) continue;
  byteCands.push({ off, t1v, t2v, delta });
}
console.log('Found ' + byteCands.length + ' byte-aligned candidates');
byteCands.sort((a, b) => Math.abs(a.delta - 1500) - Math.abs(b.delta - 1500));
for (const c of byteCands.slice(0, 20)) {
  console.log('  u32@0x' + c.off.toString(16) + ': T1=' + c.t1v + ' T2=' + c.t2v + ' Δ=+' + c.delta);
}
