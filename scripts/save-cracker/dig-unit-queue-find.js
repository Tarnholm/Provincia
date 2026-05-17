// Compare baseline T1 to "unit queued in Sparta, Pella" save to find recruitment queue

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BASELINE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const UNIT_QUEUE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 unit queued in Sparta, Pella.sav'));

console.log('Baseline: ' + BASELINE.length + ' bytes');
console.log('Unit queue: ' + UNIT_QUEUE.length + ' bytes');
console.log('Delta: +' + (UNIT_QUEUE.length - BASELINE.length) + ' bytes');

function focusedDiff(other, zoneStart, zoneEnd) {
  const diffs = [];
  for (let i = zoneStart; i <= zoneEnd && i < Math.min(BASELINE.length, other.length); i++) {
    if (BASELINE[i] !== other[i]) {
      diffs.push({ off: i, base: BASELINE[i], new: other[i] });
    }
  }
  return diffs;
}

function showRuns(diffs, label) {
  console.log('\n=== ' + label + ' (' + diffs.length + ' byte diffs) ===');
  let i = 0;
  while (i < diffs.length) {
    let runStart = i;
    while (i + 1 < diffs.length && diffs[i+1].off === diffs[i].off + 1) i++;
    const runOffStart = diffs[runStart].off;
    const runOffEnd = diffs[i].off;
    const runLen = runOffEnd - runOffStart + 1;
    if (runLen <= 32) {
      const baseHex = Array.from(BASELINE.slice(runOffStart, runOffEnd + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const newHex = Array.from(other.slice(runOffStart, runOffEnd + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log('  0x' + runOffStart.toString(16) + ' (len=' + runLen + '): base=[' + baseHex + '] → new=[' + newHex + ']');
    } else {
      console.log('  0x' + runOffStart.toString(16) + '..0x' + runOffEnd.toString(16) + ': ' + runLen + '-byte run (large)');
    }
    i++;
  }
}

const other = UNIT_QUEUE;
// Pella zone
showRuns(focusedDiff(other, 0x10500, 0x10dac), 'Pella area');
// Sparta zone
showRuns(focusedDiff(other, 0x1157c, 0x12500), 'Sparta area');
// Header/counters
showRuns(focusedDiff(other, 0xe00, 0x1090), 'Header counters');

// Look for ASCII strings that newly appear in the queue save (unit type names)
console.log('\n=== ASCII strings in 0x37000..end of UNIT_QUEUE that DIFFER from baseline ===');
// In Alexander, unit names like "hoplites", "hypaspists" etc. The queued unit's name might appear at a NEW location
const UNIT_NAMES = ['hoplites', 'phalangists', 'hypaspists', 'companion cavalry', 'allied cavalry',
  'javelin skirmishers', 'prodromoi', 'naval biremes', 'naval triremes', 'greek peasant',
  'greek peltast', 'greek cavalry', 'cretan archers', 'peltasts', 'merc hoplites'];

for (const u of UNIT_NAMES) {
  const target = Buffer.from(u);
  const baseHits = [];
  const newHits = [];
  let p = 0;
  while ((p = BASELINE.indexOf(target, p)) !== -1) { baseHits.push(p); p++; }
  p = 0;
  while ((p = other.indexOf(target, p)) !== -1) { newHits.push(p); p++; }
  if (newHits.length !== baseHits.length) {
    console.log('  "' + u + '": baseline ' + baseHits.length + ' hits → unit_queue ' + newHits.length + ' hits (Δ=' + (newHits.length - baseHits.length) + ')');
  }
}
