// dig-tax-groundtruth.js
//
// Controlled ground-truth diff for the per-settlement TAX RATE field.
//
// Alexander campaign, Macedon-played, Turn 1. We have three saves taken from
// the SAME turn-1 state:
//   baseline                              (no tax change)
//   "taxes increased in Pella"            (Pella tax raised one step)
//   "taxes lowered in sparta"             (Sparta tax lowered one step)
//
// A pure tax-rate change with no other action should produce a TINY,
// localized diff: ideally a single byte inside the affected settlement's
// stats block. We diff the full file, then zoom into Pella's / Sparta's
// stats blocks and print EVERY differing byte (and surrounding context) so
// we can pin the exact offset relative to the settlement-name pstr16.
//
// Read-only. No app code touched.

const fs = require('fs');
const path = require('path');

const ALEX = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const baseline   = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1.sav'));
const pellaUp    = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1 taxes increased in Pella.sav'));
const spartaDown = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1 taxes lowered in sparta.sav'));

console.log('sizes  baseline=%d  pellaUp=%d  spartaDown=%d', baseline.length, pellaUp.length, spartaDown.length);
console.log('size delta pellaUp=%d  spartaDown=%d (0 = pure overwrite, no insertion)',
  pellaUp.length - baseline.length, spartaDown.length - baseline.length);

function findUtf16(buf, str, from = 0) {
  const t = Buffer.alloc(2 + str.length * 2);
  t.writeUInt16LE(str.length, 0);
  for (let i = 0; i < str.length; i++) t.writeUInt16LE(str.charCodeAt(i), 2 + i * 2);
  return buf.indexOf(t, from);
}

// 1) Full-file byte diff (same length expected). Report each differing offset
//    grouped into runs, with hex context, so we can see EVERY change.
function fullDiff(a, b, label) {
  console.log('\n========== FULL-FILE DIFF: ' + label + ' ==========');
  if (a.length !== b.length) {
    console.log('  length differs (%d vs %d) — comparing common prefix', a.length, b.length);
  }
  const len = Math.min(a.length, b.length);
  const runs = [];
  let runStart = -1;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) { if (runStart === -1) runStart = i; }
    else if (runStart !== -1) { runs.push([runStart, i - 1]); runStart = -1; }
  }
  if (runStart !== -1) runs.push([runStart, len - 1]);
  console.log('  total differing runs: ' + runs.length);
  let shown = 0;
  for (const [s, e] of runs) {
    const rl = e - s + 1;
    if (rl > 24) { console.log('  0x%s run=%d (large, skipped context)', s.toString(16), rl); continue; }
    const ah = Array.from(a.slice(s, e + 1)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const bh = Array.from(b.slice(s, e + 1)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    console.log('  0x%s run=%d  base[%s]  new[%s]', s.toString(16), rl, ah, bh);
    if (++shown > 60) { console.log('  ...(truncated)'); break; }
  }
  return runs;
}

const pellaRuns  = fullDiff(baseline, pellaUp,    'baseline -> Pella tax UP');
const spartaRuns = fullDiff(baseline, spartaDown, 'baseline -> Sparta tax DOWN');

// 2) Locate the changed settlement's name pstr16 and report each diff run's
//    dx relative to that name prefix. Confirms the field offset.
function reportDxForSettlement(a, b, runs, settlement) {
  console.log('\n----- diff runs near %s stats block -----', settlement);
  const namePos = findUtf16(a, settlement);
  if (namePos < 0) { console.log('  (name not found)'); return; }
  console.log('  %s name pstr16 prefix @ 0x%s', settlement, namePos.toString(16));
  // stats block is name-583 .. name. Report any run that overlaps a wide window.
  const winLo = namePos - 700, winHi = namePos + 300;
  let found = 0;
  for (const [s, e] of runs) {
    if (e < winLo || s > winHi) continue;
    for (let off = s; off <= e; off++) {
      const dx = off - namePos;
      console.log('    dx=%d  base=%d  new=%d  (Δ=%d)', dx, a[off], b[off], b[off] - a[off]);
    }
    found++;
  }
  if (!found) console.log('  (no diff runs within [-700,+300] of name — change is elsewhere)');
}

reportDxForSettlement(baseline, pellaUp,    pellaRuns,  'Pella');
reportDxForSettlement(baseline, spartaDown, spartaRuns, 'Sparta');

// 3) For confirmation, dump the byte at the candidate dx=-562 for the changed
//    settlement across all three saves.
function valAt(buf, settlement, dx) {
  const p = findUtf16(buf, settlement);
  return p < 0 ? null : buf[p + dx];
}
console.log('\n========== candidate dx=-562 across saves ==========');
console.log('  Pella : base=%d  pellaUp=%d  spartaDown=%d',
  valAt(baseline, 'Pella', -562), valAt(pellaUp, 'Pella', -562), valAt(spartaDown, 'Pella', -562));
console.log('  Sparta: base=%d  pellaUp=%d  spartaDown=%d',
  valAt(baseline, 'Sparta', -562), valAt(pellaUp, 'Sparta', -562), valAt(spartaDown, 'Sparta', -562));
