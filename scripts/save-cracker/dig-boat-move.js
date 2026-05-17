// Compare T1 baseline vs "boat moved to port" — should be a clean single-unit position change

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BASELINE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const BOAT_PORT = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 boat moved to port.sav'));

console.log('Baseline:  ' + BASELINE.length + ' bytes');
console.log('Boat-port: ' + BOAT_PORT.length + ' bytes');
console.log('Delta:     ' + (BOAT_PORT.length - BASELINE.length));

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

const runs = diffRuns(BASELINE, BOAT_PORT);
const smallRuns = runs.filter(r => r.len <= 8);
console.log('\nTotal diff runs: ' + runs.length + ', small (≤8 bytes): ' + smallRuns.length);

// Group by zone
const byZone = {};
for (const r of smallRuns) {
  const z = zoneOf(r.start);
  if (!byZone[z]) byZone[z] = [];
  byZone[z].push(r);
}
console.log('\n=== Diffs by zone (small runs) ===');
for (const [zone, list] of Object.entries(byZone)) {
  console.log('  ' + zone.padEnd(20) + ' ' + list.length + ' runs');
}

// Show smallest, surgical-looking diffs first
console.log('\n=== All 1-byte diffs ===');
const oneByte = smallRuns.filter(r => r.len === 1);
console.log('Total 1-byte diffs: ' + oneByte.length);
for (const r of oneByte.slice(0, 30)) {
  console.log('  0x' + r.start.toString(16) + ' [' + zoneOf(r.start).padEnd(14) + ']: ' + BASELINE[r.start] + ' → ' + BOAT_PORT[r.start] + ' (Δ=' + (BOAT_PORT[r.start] - BASELINE[r.start]) + ')');
}

console.log('\n=== 4-byte diffs (potential coords/i32 values) ===');
const fourByte = smallRuns.filter(r => r.len === 4);
console.log('Total 4-byte diffs: ' + fourByte.length);
for (const r of fourByte.slice(0, 20)) {
  const baseVal = BASELINE.readInt32LE(r.start);
  const newVal = BOAT_PORT.readInt32LE(r.start);
  if (Math.abs(baseVal) < 100000 && Math.abs(newVal) < 100000) {
    console.log('  0x' + r.start.toString(16) + ' [' + zoneOf(r.start).padEnd(14) + ']: ' + baseVal + ' → ' + newVal);
  }
}

// In Alexander, the user has a fleet (boats). Check unit zone for naval biremes shifts
console.log('\n=== Diffs in units zone with naval coords ===');
const unitsZone = (byZone['units'] || []);
console.log('Total small unit-zone diffs: ' + unitsZone.length);
for (const r of unitsZone.slice(0, 20)) {
  const baseHex = Array.from(BASELINE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(BOAT_PORT.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  0x' + r.start.toString(16) + ' len=' + r.len + ': [' + baseHex + '] → [' + newHex + ']');
}
