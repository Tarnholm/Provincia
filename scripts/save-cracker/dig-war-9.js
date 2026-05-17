// Look for SMALL diff clusters between peace and war that change SAME
// number of bytes in both (lenA == lenB), and aren't part of the
// shifting-content noise. Those are likely the diplomatic-state flags.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

// Run a CAREFUL walking diff and capture all clusters with small in-place
// modifications (lenA==lenB, lenA <= 16). These bypass the "structural
// shift" noise.

const RESYNC_WINDOW = 64;
const RESYNC_RUN = 24;
function findResync(aOff, bOff) {
  for (let shift = 0; shift <= RESYNC_WINDOW; shift++) {
    for (const sign of [+1, -1]) {
      const s = shift * sign;
      const aBase = aOff;
      const bBase = bOff + s;
      if (bBase < 0 || bBase + RESYNC_RUN > war.length) continue;
      if (aBase + RESYNC_RUN > peace.length) continue;
      let ok = true;
      for (let k = 0; k < RESYNC_RUN; k++) {
        if (peace[aBase + k] !== war[bBase + k]) { ok = false; break; }
      }
      if (ok) return { aOff: aBase, bOff: bBase, shift: s };
      if (shift === 0) break;
    }
  }
  return null;
}

const diffs = [];
let i = 0, j = 0;
let inDiff = false;
let diffStartA = 0, diffStartB = 0;
const MAX = 100000;
while (i < peace.length && j < war.length) {
  if (peace[i] === war[j]) {
    if (inDiff) { diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB }); inDiff = false; }
    i++; j++;
  } else {
    if (!inDiff) { diffStartA = i; diffStartB = j; inDiff = true; }
    const r = findResync(i, j);
    if (r) {
      diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: r.aOff - diffStartA, lenB: r.bOff - diffStartB });
      i = r.aOff; j = r.bOff; inDiff = false;
    } else { i++; j++; }
    if (diffs.length > MAX) break;
  }
}
if (inDiff) diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB });

// Filter to "in-place" diffs: lenA==lenB and both small (<= 16 bytes)
const inPlace = diffs.filter(d => d.lenA === d.lenB && d.lenA > 0 && d.lenA <= 16);
console.log('In-place diffs (lenA==lenB, <=16B): ' + inPlace.length);

// Cluster nearby in-place diffs
const clusters = [];
let cur = null;
for (const d of inPlace) {
  if (!cur || d.aOff - cur.aEnd > 32) {
    if (cur) clusters.push(cur);
    cur = { aStart: d.aOff, aEnd: d.aOff + d.lenA, bStart: d.bOff, bEnd: d.bOff + d.lenB, totalA: d.lenA, totalB: d.lenB, spans: 1 };
  } else {
    cur.aEnd = d.aOff + d.lenA;
    cur.bEnd = d.bOff + d.lenB;
    cur.totalA += d.lenA; cur.totalB += d.lenB; cur.spans++;
  }
}
if (cur) clusters.push(cur);

console.log('Clusters of in-place diffs (gap≤32): ' + clusters.length);
console.log('\n=== Small in-place clusters (lenA==lenB, ≤16B) ===');
// Sort by ascending total — small clusters first
const small = clusters.filter(c => c.totalA <= 16 && c.spans <= 4);
console.log('Total ≤16B clusters: ' + small.length);
for (let k = 0; k < Math.min(40, small.length); k++) {
  const c = small[k];
  const peaceBytes = Array.from(peace.subarray(c.aStart, c.aEnd)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const warBytes = Array.from(war.subarray(c.bStart, c.bEnd)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  // Also dump 8 bytes of context
  const before = Array.from(peace.subarray(c.aStart - 8, c.aStart)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const after = Array.from(peace.subarray(c.aEnd, c.aEnd + 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  cluster #' + k + ' @ peace=0x' + c.aStart.toString(16) + ' / war=0x' + c.bStart.toString(16) + '  len=' + c.totalA);
  console.log('    context-before: ' + before);
  console.log('    PEACE:          ' + peaceBytes);
  console.log('    WAR:            ' + warBytes);
  console.log('    context-after:  ' + after);
}
