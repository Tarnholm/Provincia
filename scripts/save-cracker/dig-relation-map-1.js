// Scan for all instances of the diplomatic-relation 20-byte preamble pattern
// to map out the full diplomatic-state zone and count records per faction.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

// The relation record preamble I identified: bytes -20..-4 from the attitude
// position are: 08 00 00 00 00 00 00 00 00 00 00 00 0d 00 00 00 c8 00 00 00
// (which is u32s: 8, 0, 0, 13, 200)
// Look for this pattern, then check if the next u32 is in {0, 100, 200, 400, 600}.
const PREAMBLE = Buffer.from([
  0x08, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x0d, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
]);

function findAllPreambles(buf) {
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(PREAMBLE, p)) !== -1) {
    // Verify next u32 is an attitude value (0, 100, 200, 400, 600, or -10)
    const attitudeOff = p + 20;
    if (attitudeOff + 4 > buf.length) { p++; continue; }
    const v = buf.readInt32LE(attitudeOff);
    if ([0, 100, 200, 400, 600, -10].includes(v)) {
      // Read the rest of the 16-byte record
      const state = buf.readInt32LE(attitudeOff + 4);
      const counter = buf.readInt32LE(attitudeOff + 8);
      const fourth = buf.readInt32LE(attitudeOff + 12);
      hits.push({ recordAt: attitudeOff, attitude: v, state, counter, fourth });
    }
    p++;
  }
  return hits;
}

const peaceHits = findAllPreambles(peace);
const warHits = findAllPreambles(war);

console.log('=== Total relation records ===');
console.log('peace:', peaceHits.length);
console.log('war:  ', warHits.length);

// Distribution by attitude in peace
const peaceDist = new Map();
for (const h of peaceHits) peaceDist.set(h.attitude, (peaceDist.get(h.attitude) || 0) + 1);
console.log('\nPeace attitude distribution:');
for (const [att, n] of Array.from(peaceDist.entries()).sort((a, b) => a[0] - b[0])) {
  console.log('  attitude=' + att + ': ' + n + ' records');
}

const warDist = new Map();
for (const h of warHits) warDist.set(h.attitude, (warDist.get(h.attitude) || 0) + 1);
console.log('\nWar attitude distribution:');
for (const [att, n] of Array.from(warDist.entries()).sort((a, b) => a[0] - b[0])) {
  console.log('  attitude=' + att + ': ' + n + ' records');
}

// First 50 record positions (peace) to map out the file structure
console.log('\n=== First 50 relation records in peace ===');
console.log('recordAt'.padEnd(10) + '  attitude  state  counter  fourth');
for (const h of peaceHits.slice(0, 50)) {
  console.log('  0x' + h.recordAt.toString(16).padStart(8, '0') + '  ' +
              String(h.attitude).padStart(8) + '  ' +
              String(h.state).padStart(5) + '  ' +
              String(h.counter).padStart(7) + '  ' +
              String(h.fourth).padStart(6));
}

// Gaps between consecutive records — should reveal record-block sizes
console.log('\n=== Spacing between consecutive records (peace) ===');
const gaps = [];
for (let i = 1; i < peaceHits.length; i++) {
  gaps.push({ from: peaceHits[i-1].recordAt, to: peaceHits[i].recordAt, gap: peaceHits[i].recordAt - peaceHits[i-1].recordAt });
}
// Show only gaps of interest (different from common values)
const gapHist = new Map();
for (const g of gaps) gapHist.set(g.gap, (gapHist.get(g.gap) || 0) + 1);
console.log('Top 10 most common gap values:');
const gapSorted = Array.from(gapHist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [gap, n] of gapSorted) console.log('  gap=' + gap + ' (0x' + gap.toString(16) + '): ' + n + ' occurrences');

// File-position range covered by relation records
if (peaceHits.length > 0) {
  console.log('\nFile range: first=0x' + peaceHits[0].recordAt.toString(16) + '  last=0x' + peaceHits[peaceHits.length - 1].recordAt.toString(16));
  console.log('Total span: ' + (peaceHits[peaceHits.length - 1].recordAt - peaceHits[0].recordAt) + ' bytes');
}

// Compare peace vs war record-by-record for attitude changes
console.log('\n=== Records that CHANGED attitude between peace and war ===');
// Pair by file position (assuming similar count and order)
if (peaceHits.length === warHits.length) {
  for (let i = 0; i < peaceHits.length; i++) {
    if (peaceHits[i].attitude !== warHits[i].attitude) {
      console.log('  peace[' + i + ']: ' + peaceHits[i].attitude + ' → ' + warHits[i].attitude +
                  '  (peace.recordAt=0x' + peaceHits[i].recordAt.toString(16) +
                  ', war.recordAt=0x' + warHits[i].recordAt.toString(16) + ')');
    }
  }
} else {
  console.log('Count mismatch: peace=' + peaceHits.length + ' vs war=' + warHits.length);
}
