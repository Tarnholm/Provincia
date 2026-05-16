// Compare both siege saves against peace baseline. If they're at the same
// game state (post-siege, pre-End-Turn), the diff between them should be
// near-zero (resave noise). If one includes End Turn processing, it'll be
// significantly different.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const siege1 = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged .sav'));
const siege2 = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

console.log('peace:                ', peace.length);
console.log('siege1 (ended turn?): ', siege1.length, '(Δ=' + (siege1.length - peace.length) + ')');
console.log('siege2 (no end turn?):', siege2.length, '(Δ=' + (siege2.length - peace.length) + ')');
console.log('siege1 vs siege2:     ', '(Δ=' + (siege2.length - siege1.length) + ')');

// Front+back diff of siege1 vs siege2
let frontDiff = -1;
for (let i = 0; i < Math.min(siege1.length, siege2.length); i++) {
  if (siege1[i] !== siege2[i]) { frontDiff = i; break; }
}
let backDiff = -1;
let ai = siege1.length - 1, bi = siege2.length - 1;
while (ai >= 0 && bi >= 0) {
  if (siege1[ai] !== siege2[bi]) { backDiff = bi; break; }
  ai--; bi--;
}
console.log('\nsiege1 vs siege2:');
console.log('  First diff: 0x' + frontDiff.toString(16));
console.log('  Last diff (in siege2): 0x' + backDiff.toString(16));
console.log('  Divergence width: ' + (backDiff - frontDiff + 1) + ' bytes');

// Diff peace vs siege2 (the newer one — supposedly cleaner state)
let frontPV = -1;
for (let i = 0; i < Math.min(peace.length, siege2.length); i++) {
  if (peace[i] !== siege2[i]) { frontPV = i; break; }
}
let backPV = -1;
let aii = peace.length - 1, bii = siege2.length - 1;
while (aii >= 0 && bii >= 0) {
  if (peace[aii] !== siege2[bii]) { backPV = bii; break; }
  aii--; bii--;
}
console.log('\npeace vs siege2:');
console.log('  First diff: 0x' + frontPV.toString(16));
console.log('  Last diff (in siege2): 0x' + backPV.toString(16));

// Carthage ASCII count
function count(buf, str) {
  let n = 0, p = 0;
  const needle = Buffer.from(str);
  while ((p = buf.indexOf(needle, p)) !== -1) { n++; p++; }
  return n;
}
console.log('\nFaction ASCII counts (peace / siege1 / siege2):');
for (const f of ['carthage', 'spain', 'numidia', 'gauls']) {
  console.log('  ' + f.padEnd(14) + 'peace=' + count(peace, f) + '  siege1=' + count(siege1, f) + '  siege2=' + count(siege2, f));
}

// Are siege1 and siege2 essentially the same state? If yes (small diff),
// both are post-siege pre-End-Turn captures.
// If big diff, they're at different game states.

// Walking diff: how many cluster of changes?
const RESYNC_WINDOW = 128;
const RESYNC_RUN = 16;
function diff(a, b) {
  const findResync = (aOff, bOff) => {
    for (let shift = 0; shift <= RESYNC_WINDOW; shift++) {
      for (const sign of [+1, -1]) {
        const s = shift * sign;
        const aBase = aOff;
        const bBase = bOff + s;
        if (bBase < 0 || bBase + RESYNC_RUN > b.length) continue;
        if (aBase + RESYNC_RUN > a.length) continue;
        let ok = true;
        for (let k = 0; k < RESYNC_RUN; k++) {
          if (a[aBase + k] !== b[bBase + k]) { ok = false; break; }
        }
        if (ok) return { aOff: aBase, bOff: bBase, shift: s };
        if (shift === 0) break;
      }
    }
    return null;
  };
  const diffs = [];
  let i = 0, j = 0;
  let inDiff = false;
  let diffStartA = 0, diffStartB = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      if (inDiff) { diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB }); inDiff = false; }
      i++; j++;
    } else {
      if (!inDiff) { diffStartA = i; diffStartB = j; inDiff = true; }
      const r = findResync(i, j);
      if (r) { diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: r.aOff - diffStartA, lenB: r.bOff - diffStartB }); i = r.aOff; j = r.bOff; inDiff = false; }
      else { i++; j++; }
    }
  }
  if (inDiff) diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB });
  return diffs.length;
}

console.log('\nWalking-diff span counts:');
console.log('  siege1 vs siege2:', diff(siege1, siege2));
console.log('  peace vs siege2:', diff(peace, siege2));
