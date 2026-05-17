// Find vanilla Rome's per-faction treasury table.
// In vanilla RTW, each of the 20 factions has a treasury (denarii).
// Treasury values are typically positive i32s in 100..1000000 range.
// Look for a contiguous run of 20 such values.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Look for 20 consecutive i32s in plausible treasury range
function plausibleTreasury(v) {
  return v >= -50000 && v <= 1000000;
}

console.log('=== Hunting for 20 consecutive plausible treasury values ===');
let found = 0;
for (let i = 0; i + 80 < peace.length; i++) {
  let ok = true;
  for (let k = 0; k < 20; k++) {
    if (!plausibleTreasury(peace.readInt32LE(i + k * 4))) { ok = false; break; }
  }
  if (ok && found < 20) {
    console.log('  0x' + i.toString(16) + ': [' +
      Array.from({ length: 20 }, (_, k) => peace.readInt32LE(i + k * 4)).join(', ') + ']');
    found++;
    i += 80;  // skip past
  }
}

console.log('\n=== Same hunt but stride 8 (i32 + something) ===');
found = 0;
for (let i = 0; i + 160 < peace.length; i++) {
  let ok = true;
  for (let k = 0; k < 20; k++) {
    if (!plausibleTreasury(peace.readInt32LE(i + k * 8))) { ok = false; break; }
  }
  if (ok && found < 20) {
    console.log('  0x' + i.toString(16) + ': [' +
      Array.from({ length: 20 }, (_, k) => peace.readInt32LE(i + k * 8)).join(', ') + ']');
    found++;
    i += 160;
  }
}

// In vanilla RTW Spain has ~5000 starting treasury. Look for u32=5000 in
// the LOW offsets (under 0x10000)
console.log('\n=== u32 values close to typical treasury amounts in header ===');
const TYPICAL_TREASURIES = [5000, 7000, 10000, 15000, 20000];
for (const t of TYPICAL_TREASURIES) {
  for (let i = 0; i < 0x10000; i += 4) {
    const v = peace.readInt32LE(i);
    if (v === t) {
      console.log('  ' + t + ' found at 0x' + i.toString(16));
    }
  }
}

// Also: vanilla Rome saves have a "current_faction_treasury" displayed in
// the engine. Look for u32 that might be Spain's treasury changing over
// the user's gameplay (across the 11 Spain saves).
console.log('\n=== Look for u32 values that differ across the 11 Spain saves ===');
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain')).map(f => fs.readFileSync(path.join(BASE, f)));
// Find u32 positions where the value varies between min 5000 and max 100000
const TREASURE_RANGE = [1000, 100000];
let candidates = [];
for (let off = 0; off < 0x10000; off += 4) {
  let allOk = true;
  let minV = Infinity, maxV = -Infinity;
  for (const buf of allFiles) {
    if (off + 4 > buf.length) { allOk = false; break; }
    const v = buf.readInt32LE(off);
    if (v < TREASURE_RANGE[0] || v > TREASURE_RANGE[1]) { allOk = false; break; }
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (allOk && maxV > minV && (maxV - minV) >= 100 && (maxV - minV) <= 50000) {
    candidates.push({ off, min: minV, max: maxV, range: maxV - minV });
  }
}
console.log('Found candidates: ' + candidates.length);
candidates.sort((a, b) => b.range - a.range);
for (const c of candidates.slice(0, 30)) {
  console.log('  0x' + c.off.toString(16) + ': min=' + c.min + ' max=' + c.max + ' range=' + c.range);
}
