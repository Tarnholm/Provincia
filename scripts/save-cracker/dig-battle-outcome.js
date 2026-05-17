// Compare "Turn 2 attack rebel army" (before battle) vs "Turn 2 clear victory enemy army gone" (after)
// Same turn, single action (battle resolved) — should pinpoint unit casualties + enemy army removal

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BEFORE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 2 attack rebel army.sav'));
const AFTER = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 2 clear victory enemy army gone.sav'));

console.log('Before battle: ' + BEFORE.length + ' bytes');
console.log('After battle:  ' + AFTER.length + ' bytes');
console.log('Delta:         ' + (AFTER.length - BEFORE.length) + ' bytes');

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

const runs = diffRuns(BEFORE, AFTER);
const smallRuns = runs.filter(r => r.len <= 16);
console.log('\nTotal diff runs: ' + runs.length + ', small (≤16 bytes): ' + smallRuns.length);

// Group by zone
const byZone = {};
for (const r of smallRuns) {
  const z = zoneOf(r.start);
  if (!byZone[z]) byZone[z] = [];
  byZone[z].push(r);
}
console.log('\n=== Diffs by zone ===');
for (const [zone, list] of Object.entries(byZone)) {
  console.log('  ' + zone.padEnd(20) + ' ' + list.length + ' small runs');
}

// Show diffs in characters zone (battle should affect character state)
console.log('\n=== Character-records zone diffs ===');
const charDiffs = byZone['character-records'] || [];
for (const r of charDiffs.slice(0, 20)) {
  const baseHex = Array.from(BEFORE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(AFTER.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  let interp = '';
  if (r.len === 1) interp = ' (' + BEFORE[r.start] + ' → ' + AFTER[r.start] + ')';
  else if (r.len === 4) {
    const baseVal = BEFORE.readInt32LE(r.start);
    const newVal = AFTER.readInt32LE(r.start);
    if (Math.abs(baseVal) < 10000000 && Math.abs(newVal) < 10000000) interp = ' (i32 ' + baseVal + ' → ' + newVal + ')';
  }
  console.log('  0x' + r.start.toString(16) + ' len=' + r.len + ' base=[' + baseHex + '] → new=[' + newHex + ']' + interp);
}

// Show diffs in units zone (army state)
console.log('\n=== Unit zone diffs (>=0x37000), first 20 small ===');
const unitDiffs = (byZone['units'] || []).filter(r => r.len <= 8);
for (const r of unitDiffs.slice(0, 20)) {
  const baseHex = Array.from(BEFORE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(AFTER.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  let interp = '';
  if (r.len === 4) {
    const baseVal = BEFORE.readInt32LE(r.start);
    const newVal = AFTER.readInt32LE(r.start);
    if (Math.abs(baseVal) < 10000) interp = ' (i32 ' + baseVal + ' → ' + newVal + ')';
  }
  console.log('  0x' + r.start.toString(16) + ' len=' + r.len + ' base=[' + baseHex + '] → new=[' + newHex + ']' + interp);
}
