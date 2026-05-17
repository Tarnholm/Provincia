// Compare "Turn 1 attack enemy that retreats" vs baseline
// to find combat outcome bytes when enemy retreats (no battle, no casualties)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BASELINE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const RETREAT = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 attack enemy that retreats.sav'));

console.log('Baseline: ' + BASELINE.length);
console.log('Retreat:  ' + RETREAT.length);
console.log('Delta:    ' + (RETREAT.length - BASELINE.length));

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

const runs = diffRuns(BASELINE, RETREAT);
const byZone = {};
for (const r of runs.filter(r => r.len <= 8)) {
  const z = zoneOf(r.start);
  if (!byZone[z]) byZone[z] = [];
  byZone[z].push(r);
}

console.log('\n=== Diff counts by zone (small runs ≤8 bytes) ===');
for (const [zone, list] of Object.entries(byZone)) {
  console.log('  ' + zone.padEnd(20) + ' ' + list.length);
}

// Focus on character-records (where attacker character's MP would change)
console.log('\n=== Character-records zone diffs ===');
const charDiffs = byZone['character-records'] || [];
for (const r of charDiffs.slice(0, 15)) {
  const baseHex = Array.from(BASELINE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(RETREAT.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  let interp = '';
  if (r.len === 1) {
    interp = ' (' + BASELINE[r.start] + ' → ' + RETREAT[r.start] + ', Δ=' + (RETREAT[r.start] - BASELINE[r.start]) + ')';
  }
  console.log('  0x' + r.start.toString(16) + ' len=' + r.len + ': [' + baseHex + '] → [' + newHex + ']' + interp);
}

// Sample first 20 1-byte diffs in event-log and tile-events (small zones)
console.log('\n=== Event-log + tile-events 1-byte diffs (combat outcome record) ===');
const elDiffs = byZone['event-log'] || [];
const teDiffs = byZone['tile-events'] || [];
for (const r of [...elDiffs, ...teDiffs].filter(r => r.len <= 2).slice(0, 20)) {
  const baseHex = Array.from(BASELINE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(RETREAT.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  0x' + r.start.toString(16) + ' [' + zoneOf(r.start) + '] len=' + r.len + ' [' + baseHex + '] → [' + newHex + ']');
}
