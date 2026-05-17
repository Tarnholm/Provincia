// Compare T2 baseline vs "Turn 2 moved army" to find character/army position fields

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T2_BASE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 2.sav'));
const T2_MOVED = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 2 moved army.sav'));

console.log('T2 base:  ' + T2_BASE.length + ' bytes');
console.log('T2 moved: ' + T2_MOVED.length + ' bytes');
console.log('Delta:    ' + (T2_MOVED.length - T2_BASE.length) + ' bytes');

function diffRuns(a, b) {
  const len = Math.min(a.length, b.length);
  const runs = [];
  let runStart = -1;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        runs.push({ start: runStart, end: i - 1, len: i - runStart });
        runStart = -1;
      }
    }
  }
  if (runStart !== -1) runs.push({ start: runStart, end: len - 1, len: len - runStart });
  return runs;
}

const runs = diffRuns(T2_BASE, T2_MOVED);
console.log('\nTotal diff runs: ' + runs.length);

// Filter for small runs (real state changes, not pointer shifts)
const smallRuns = runs.filter(r => r.len <= 8);
console.log('Small runs (≤8 bytes): ' + smallRuns.length);

// Categorize by likely zone
function zoneOf(off) {
  if (off < 0x1000) return 'header';
  if (off < 0x1190) return 'section-registry';
  if (off < 0x14a0) return 'owner-table';
  if (off < 0x4800) return 'event-log';
  if (off < 0x5400) return 'character-records';
  if (off < 0x5cf0) return 'historic-events';
  if (off < 0x7b88) return 'tile-events';
  if (off < 0x7c20) return 'wonders';
  if (off < 0xcff0) return 'polygons';
  if (off < 0x1943f) return 'diplomacy';
  if (off < 0x37000) return 'settlements';
  if (off < 0x3e000) return 'merc-pools';
  return 'units';
}

console.log('\n=== First 30 small diff runs ===');
for (const r of smallRuns.slice(0, 30)) {
  const baseHex = Array.from(T2_BASE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(T2_MOVED.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  let interp = '';
  if (r.len === 1) interp = ' (' + T2_BASE[r.start] + ' → ' + T2_MOVED[r.start] + ', Δ=' + (T2_MOVED[r.start] - T2_BASE[r.start]) + ')';
  else if (r.len === 4) {
    const baseVal = T2_BASE.readInt32LE(r.start);
    const newVal = T2_MOVED.readInt32LE(r.start);
    interp = ' (i32: ' + baseVal + ' → ' + newVal + ', Δ=' + (newVal - baseVal) + ')';
  }
  console.log('  0x' + r.start.toString(16) + ' [' + zoneOf(r.start).padEnd(14) + '] len=' + r.len + ' base=[' + baseHex + '] → new=[' + newHex + ']' + interp);
}

// Look for changes specifically in the units zone (where character positions are)
console.log('\n=== Diffs in units zone (0x37000..end) ===');
const unitDiffs = smallRuns.filter(r => r.start >= 0x37000 && r.len <= 4);
console.log('Found ' + unitDiffs.length + ' small unit-zone diffs');
for (const r of unitDiffs.slice(0, 20)) {
  const baseHex = Array.from(T2_BASE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(T2_MOVED.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  let interp = '';
  if (r.len === 4) {
    const baseVal = T2_BASE.readInt32LE(r.start);
    const newVal = T2_MOVED.readInt32LE(r.start);
    if (Math.abs(baseVal) < 10000 && Math.abs(newVal) < 10000) {
      interp = ' (i32 ' + baseVal + ' → ' + newVal + ')';
    }
  }
  console.log('  0x' + r.start.toString(16) + ' len=' + r.len + ': base=[' + baseHex + '] → new=[' + newHex + ']' + interp);
}
