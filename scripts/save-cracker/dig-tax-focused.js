// Focused tax-change diff — only look at specific zones

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BASELINE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const TAXES_INC_PELLA = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 taxes increased in Pella.sav'));
const TAXES_LOW_SPARTA = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 taxes lowered in sparta.sav'));

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const baselineDS = findPstr16Asciiz(BASELINE, 'default_set');
console.log('Baseline default_set count: ' + baselineDS.length);

// Define settlement zones
// Settlement 0 (Pella): defSet at 0x10748, stats block at 0x10748 - 583 - 14 = 0x1052a
// Settlement 1 (Sparta): defSet at 0x10dac
// Settlement 2 (real Sparta or other): defSet at 0x1157c

// Find Pella's name offset (the first settlement with name) — it might not have one,
// so use defSet as anchor.

function focusedDiff(other, label, zoneStart, zoneEnd) {
  const diffs = [];
  for (let i = zoneStart; i <= zoneEnd && i < Math.min(BASELINE.length, other.length); i++) {
    if (BASELINE[i] !== other[i]) {
      diffs.push({ off: i, base: BASELINE[i], new: other[i] });
    }
  }
  console.log('\n=== ' + label + ' in 0x' + zoneStart.toString(16) + '..0x' + zoneEnd.toString(16) + ' (' + diffs.length + ' byte diffs) ===');
  // Group into runs
  let i = 0;
  while (i < diffs.length) {
    let runStart = i;
    while (i + 1 < diffs.length && diffs[i+1].off === diffs[i].off + 1) i++;
    const runOffStart = diffs[runStart].off;
    const runOffEnd = diffs[i].off;
    const runLen = runOffEnd - runOffStart + 1;
    if (runLen <= 16) {
      const baseHex = Array.from(BASELINE.slice(runOffStart, runOffEnd + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const newHex = Array.from(other.slice(runOffStart, runOffEnd + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      // Interpret as u32 if possible
      let interp = '';
      if (runLen === 1 || runLen === 2 || runLen === 4) {
        const baseVal = runLen === 1 ? BASELINE[runOffStart] : runLen === 2 ? BASELINE.readUInt16LE(runOffStart) : BASELINE.readUInt32LE(runOffStart);
        const newVal = runLen === 1 ? other[runOffStart] : runLen === 2 ? other.readUInt16LE(runOffStart) : other.readUInt32LE(runOffStart);
        interp = '  (' + baseVal + ' → ' + newVal + ', Δ=' + (newVal - baseVal) + ')';
      }
      console.log('  0x' + runOffStart.toString(16) + (runLen > 1 ? '..0x' + runOffEnd.toString(16) : '') + ': base=[' + baseHex + '] → new=[' + newHex + ']' + interp);
    } else {
      console.log('  0x' + runOffStart.toString(16) + '..0x' + runOffEnd.toString(16) + ': ' + runLen + '-byte run');
    }
    i++;
  }
}

// Focus on Pella (settlement 0) area + Sparta (settlement 2) area + header
console.log('=== TAXES INCREASED IN PELLA ===');
focusedDiff(TAXES_INC_PELLA, 'Pella area (0x10500..0x10dac)', 0x10500, 0x10dac);
focusedDiff(TAXES_INC_PELLA, 'Sparta area (0x1157c..0x11e00)', 0x1157c, 0x11e00);
focusedDiff(TAXES_INC_PELLA, 'Header counters (0xefd..0x1050)', 0xefd, 0x1050);

console.log('\n\n=== TAXES LOWERED IN SPARTA ===');
focusedDiff(TAXES_LOW_SPARTA, 'Pella area (0x10500..0x10dac)', 0x10500, 0x10dac);
focusedDiff(TAXES_LOW_SPARTA, 'Sparta area (0x1157c..0x11e00)', 0x1157c, 0x11e00);
focusedDiff(TAXES_LOW_SPARTA, 'Header counters (0xefd..0x1050)', 0xefd, 0x1050);
