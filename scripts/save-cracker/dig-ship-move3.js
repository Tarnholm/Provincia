// dig-ship-move3.js — Find the ship POSITION change.
// We expect a small u32 pair (x,y) change somewhere — but it's hidden in 248k diffs.
// Strategy: find diffs that look like a NEW position record:
//   - Two adjacent u32s changed, each by ≤2 (one tile move).
//   - In the body root range (0x800..0x800000) where character/army positions live.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_5.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');
const N = A.length;

// Find all u32 changes where both A and B values are < 4096 (likely tile coords)
// and |A-B| ≤ 5 (one or two tile move)
console.log('=== Searching for "small u32 changes" — likely tile coords ===');
const candidates = [];
for (let i = 0; i < N - 4; i += 4) {
  if (A[i] === B[i] && A[i+1] === B[i+1] && A[i+2] === B[i+2] && A[i+3] === B[i+3]) continue;
  const a = A.readUInt32LE(i);
  const b = B.readUInt32LE(i);
  if (a !== b && a < 4096 && b < 4096) {
    const diff = Math.abs(a - b);
    if (diff > 0 && diff <= 10) {
      candidates.push({ off: i, a, b, diff });
    }
  }
}
console.log(`Candidate "small-coord" u32 changes: ${candidates.length}`);

// Cluster by file region; show only candidates that have ANOTHER candidate within 8 bytes
// (since position is x,y pair)
const paired = [];
for (let i = 0; i < candidates.length; i++) {
  for (let j = i + 1; j < candidates.length; j++) {
    const d = candidates[j].off - candidates[i].off;
    if (d > 16) break;
    if (d >= 4 && d <= 12) {
      paired.push({ c1: candidates[i], c2: candidates[j] });
    }
  }
}
console.log(`Paired (within 16B): ${paired.length}`);
for (const p of paired.slice(0, 40)) {
  console.log(`  ${hex(p.c1.off)} ${p.c1.a}→${p.c1.b} (Δ${p.c1.b - p.c1.a})  +  ${hex(p.c2.off)} ${p.c2.a}→${p.c2.b} (Δ${p.c2.b - p.c2.a})  pair_dist=${p.c2.off - p.c1.off}`);
}

// Filter: pairs where Δx² + Δy² ≤ 4 (one tile move maximum)
console.log('\nTight pairs (sum |Δ| ≤ 3):');
for (const p of paired) {
  const dx = p.c2.a - p.c2.b;
  const dy = p.c1.a - p.c1.b;
  if (Math.abs(dx) + Math.abs(dy) <= 3 && (dx !== 0 || dy !== 0)) {
    console.log(`  ${hex(p.c1.off)} (${p.c1.a}→${p.c1.b}) + ${hex(p.c2.off)} (${p.c2.a}→${p.c2.b})`);
  }
}

// Also look at body root range (0x3bad..0x100000)
console.log('\n=== Filtering to body-root range 0x3bad..0x100000 ===');
const bodyPaired = paired.filter(p => p.c1.off >= 0x3bad && p.c1.off < 0x100000);
console.log(`pairs in body root: ${bodyPaired.length}`);
for (const p of bodyPaired.slice(0, 30)) {
  console.log(`  ${hex(p.c1.off)} ${p.c1.a}→${p.c1.b}  +  ${hex(p.c2.off)} ${p.c2.a}→${p.c2.b}  d=${p.c2.off - p.c1.off}`);
}
