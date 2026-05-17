// Compare T1 baseline vs "Turn 1 besige Byzantium" — find siege state field

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T1_BASE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const BYZ_SIEGE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 besige Byzantium.sav'));
const FORT_SIEGE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 besige fort.sav'));

console.log('T1 baseline: ' + T1_BASE.length);
console.log('Byz siege:   ' + BYZ_SIEGE.length + ' (Δ=' + (BYZ_SIEGE.length - T1_BASE.length) + ')');
console.log('Fort siege:  ' + FORT_SIEGE.length + ' (Δ=' + (FORT_SIEGE.length - T1_BASE.length) + ')');

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

// Find Byzantium in both saves
const byzBase = findUtf16(T1_BASE, 'Byzantium');
const byzSiege = findUtf16(BYZ_SIEGE, 'Byzantium');
console.log('\nByzantium in baseline: 0x' + byzBase.toString(16));
console.log('Byzantium in siege:    0x' + byzSiege.toString(16));

function diffsNear(a, b, center, range) {
  const out = [];
  for (let i = center - range; i < center + range && i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push({ off: i, base: a[i], new: b[i] });
  }
  return out;
}

console.log('\n=== Byzantium-area diffs (baseline vs Byz siege) ±2000 bytes ===');
const byzDiffs = diffsNear(T1_BASE, BYZ_SIEGE, byzBase, 2000);
// Group into runs
let i = 0;
while (i < byzDiffs.length) {
  let runStart = i;
  while (i + 1 < byzDiffs.length && byzDiffs[i+1].off === byzDiffs[i].off + 1) i++;
  const runOffStart = byzDiffs[runStart].off;
  const runOffEnd = byzDiffs[i].off;
  const runLen = runOffEnd - runOffStart + 1;
  if (runLen <= 16) {
    const baseHex = Array.from(T1_BASE.slice(runOffStart, runOffEnd + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const newHex = Array.from(BYZ_SIEGE.slice(runOffStart, runOffEnd + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    let interp = '';
    if (runLen === 1) interp = ' (' + T1_BASE[runOffStart] + ' → ' + BYZ_SIEGE[runOffStart] + ')';
    console.log('  0x' + runOffStart.toString(16) + ' (Byz' + (runOffStart >= byzBase ? '+' : '') + (runOffStart - byzBase) + ') len=' + runLen + ' base=[' + baseHex + '] → siege=[' + newHex + ']' + interp);
  }
  i++;
}

// Look for ASCII strings that appear ONLY in siege save (army info, siege equipment etc.)
console.log('\n=== ASCII strings in 0x80000+ that DIFFER ===');
// Specifically search for "besiege" or similar siege state words
const SIEGE_WORDS = ['besiege', 'siege', 'sap_point', 'ladder', 'tower', 'ram', 'sap'];
for (const w of SIEGE_WORDS) {
  const target = Buffer.from(w);
  const baseCt = T1_BASE.toString('latin1').split(w).length - 1;
  const siegeCt = BYZ_SIEGE.toString('latin1').split(w).length - 1;
  if (baseCt !== siegeCt) {
    console.log('  "' + w + '": baseline ' + baseCt + ' → siege ' + siegeCt + ' (Δ=' + (siegeCt - baseCt) + ')');
  }
}
