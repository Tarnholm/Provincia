// Compare baseline T1 to "taxes increased/lowered" saves to find tax-rate field
// AND compare baseline to "unit queued" / "building queued" saves

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BASELINE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const TAXES_INC_PELLA = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 taxes increased in Pella.sav'));
const TAXES_LOW_SPARTA = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 taxes lowered in sparta.sav'));
const UNIT_QUEUE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 unit queued in Sparta, Pella.sav'));
const BLDG_QUEUE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'));

console.log('File sizes:');
console.log('  baseline:        ' + BASELINE.length);
console.log('  taxes inc Pella: ' + TAXES_INC_PELLA.length);
console.log('  taxes low Sparta:' + TAXES_LOW_SPARTA.length);
console.log('  unit queue:      ' + UNIT_QUEUE.length);
console.log('  bldg queue:      ' + BLDG_QUEUE.length);

function diffBufs(a, b, label) {
  const len = Math.min(a.length, b.length);
  const diffs = [];
  let runStart = -1;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        diffs.push({ start: runStart, end: i - 1 });
        runStart = -1;
      }
    }
  }
  if (runStart !== -1) diffs.push({ start: runStart, end: len - 1 });
  return diffs;
}

// Diff baseline vs each
function showDiffs(other, label) {
  const diffs = diffBufs(BASELINE, other, label);
  console.log('\n=== ' + label + ' (' + diffs.length + ' diff regions) ===');
  let regions = 0;
  for (const d of diffs) {
    const runLen = d.end - d.start + 1;
    // Only show diff regions outside the file-growing tail
    if (d.start > Math.min(BASELINE.length, other.length) - 50000) continue;
    const aHex = Array.from(BASELINE.slice(d.start, Math.min(d.start + 32, d.end + 1))).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const bHex = Array.from(other.slice(d.start, Math.min(d.start + 32, d.end + 1))).map(b => b.toString(16).padStart(2, '0')).join(' ');
    if (runLen > 32) continue;  // skip huge runs (probably restructured zones)
    console.log('  0x' + d.start.toString(16) + ' (run=' + runLen + '):');
    console.log('    base: ' + aHex);
    console.log('    new:  ' + bHex);
    regions++;
    if (regions > 30) { console.log('  ...(more)'); break; }
  }
}

showDiffs(TAXES_INC_PELLA, 'taxes_increased_in_Pella vs baseline');
showDiffs(TAXES_LOW_SPARTA, 'taxes_lowered_in_Sparta vs baseline');
showDiffs(UNIT_QUEUE, 'unit_queued_Sparta_Pella vs baseline');
showDiffs(BLDG_QUEUE, 'building_queued_Sparta_Pella vs baseline');
