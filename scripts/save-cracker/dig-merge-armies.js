// Compare T3 "autoresolve victory" vs T3 "merge armies" — find army consolidation bytes

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BEFORE = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 3 autoresolve attack, clear victory.sav'));
const MERGED = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 3 merge armies.sav'));

console.log('Before merge: ' + BEFORE.length);
console.log('After merge:  ' + MERGED.length);
console.log('Delta:        ' + (MERGED.length - BEFORE.length));

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

const runs = diffRuns(BEFORE, MERGED);
const small = runs.filter(r => r.len <= 16);
const byZone = {};
for (const r of small) {
  const z = zoneOf(r.start);
  if (!byZone[z]) byZone[z] = [];
  byZone[z].push(r);
}

console.log('\n=== Diff distribution (small runs ≤16 bytes) ===');
for (const [z, list] of Object.entries(byZone)) console.log('  ' + z.padEnd(20) + ' ' + list.length);

// Focus on character zone (army merge changes who commands what)
console.log('\n=== Character zone diffs ===');
const cz = (byZone['character-records'] || []).slice(0, 10);
for (const r of cz) {
  const baseHex = Array.from(BEFORE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(MERGED.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  0x' + r.start.toString(16) + ' len=' + r.len + ': [' + baseHex + '] → [' + newHex + ']');
}

// Now compare BEFORE vs MERGED unit count using ASCII unit names
// If 2 armies merge, the number of unit records stays the same but they're under one character
console.log('\n=== Unit-type ASCII counts (merge doesn\'t reduce unit count, just regroups) ===');
const UNITS = ['hoplites', 'phalangists', 'hypaspists', 'companion cavalry', 'allied cavalry',
  'javelin skirmishers', 'prodromoi', 'naval biremes', 'naval triremes'];
for (const u of UNITS) {
  const target = Buffer.from(u);
  let baseCt = 0, newCt = 0;
  let p = 0;
  while ((p = BEFORE.indexOf(target, p)) !== -1) { baseCt++; p++; }
  p = 0;
  while ((p = MERGED.indexOf(target, p)) !== -1) { newCt++; p++; }
  if (baseCt !== newCt) {
    console.log('  ' + u.padEnd(30) + ' ' + baseCt + ' → ' + newCt + ' (Δ=' + (newCt - baseCt) + ')');
  }
}
