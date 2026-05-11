// dig-siege4.js
// Precisely characterize the siege block by binary search:
// Given save_8 (with siege) and save_9 (without), pin the exact byte
// ranges that are present in save_8 but absent in save_9.
//
// Strategy: align save_8 and save_9 using a HASH-WINDOW approach to find
// the exact insertion points, by hashing 16-byte rolling windows.

const fs = require('fs');
const path = require('path');

const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const s8 = fs.readFileSync(path.join(SAVES_DIR,'save_8.1.sav'));
const s9 = fs.readFileSync(path.join(SAVES_DIR,'save_9.1.sav'));

// Find longest common run starting at given pair of offsets
function commonRun(A, ai, B, bi) {
  let n = 0;
  const lim = Math.min(A.length - ai, B.length - bi);
  while (n < lim && A[ai+n] === B[bi+n]) n++;
  return n;
}

// Bidirectional diff: walk A and B, when they diverge, find next sync
function alignedDiff(A, B) {
  const events = []; // {kind, aStart, aEnd, bStart, bEnd}
  let i = 0, j = 0;
  const lenA = A.length, lenB = B.length;
  while (i < lenA && j < lenB) {
    if (A[i] === B[j]) { i++; j++; continue; }
    // Find a sync point using a 16-byte window match
    let best = null;
    const W = 16;
    // Bound the search to 256 bytes; for clean deletes this is plenty.
    for (let dj = 0; dj <= 256 && j+dj+W <= lenB && i+W <= lenA; dj++) {
      let ok = true;
      for (let k = 0; k < W; k++) if (A[i+k] !== B[j+dj+k]) { ok=false; break; }
      if (ok) { best = { type: 'insertInB', dj, di: 0 }; break; }
    }
    for (let di = 0; di <= 256 && i+di+W <= lenA && j+W <= lenB; di++) {
      let ok = true;
      for (let k = 0; k < W; k++) if (A[i+di+k] !== B[j+k]) { ok=false; break; }
      if (ok) {
        if (!best || di < best.dj) best = { type: 'deleteFromA', dj: 0, di };
        break;
      }
    }
    if (!best) { i++; j++; continue; }
    if (best.type === 'insertInB') {
      events.push({ kind: 'insert', bStart: j, bEnd: j + best.dj, aPos: i });
      j += best.dj;
    } else {
      events.push({ kind: 'delete', aStart: i, aEnd: i + best.di, bPos: j });
      i += best.di;
    }
  }
  if (i < lenA) events.push({ kind: 'delete', aStart: i, aEnd: lenA, bPos: j });
  if (j < lenB) events.push({ kind: 'insert', bStart: j, bEnd: lenB, aPos: i });
  return events;
}

console.log('Computing aligned diff save_8 → save_9 (expected pure -73 bytes)...');
const events = alignedDiff(s8, s9);
let inserts=0, deletes=0, insLen=0, delLen=0;
for (const e of events) {
  if (e.kind==='insert') { inserts++; insLen += e.bEnd - e.bStart; }
  else if (e.kind==='delete') { deletes++; delLen += e.aEnd - e.aStart; }
}
console.log(`Events: ${events.length}  inserts:${inserts} (${insLen}B)  deletes:${deletes} (${delLen}B)  net:${insLen-delLen}`);
console.log(`\nALL events:`);
for (const e of events) {
  if (e.kind === 'delete') {
    const n = e.aEnd - e.aStart;
    console.log(`  DELETE @ A=0x${e.aStart.toString(16)} .. 0x${e.aEnd.toString(16)}  (${n}B)  bPos=0x${e.bPos.toString(16)}`);
  } else {
    const n = e.bEnd - e.bStart;
    console.log(`  INSERT @ B=0x${e.bStart.toString(16)} .. 0x${e.bEnd.toString(16)}  (${n}B)  aPos=0x${e.aPos.toString(16)}`);
  }
}

// Show full hex dump of each delete with surrounding context
console.log('\n--- Detailed deletes ---');
function hex(buf, off, n=64) {
  const s=[];
  for (let i=0;i<n && off+i<buf.length;i++){
    s.push(buf[off+i].toString(16).padStart(2,'0'));
    if ((i+1)%16===0) s.push('\n');
  }
  return s.join(' ');
}
function ascii(buf, off, n=64) {
  let s=''; for (let i=0;i<n && off+i<buf.length;i++){ const b=buf[off+i]; s+=(b>=32 && b<127)?String.fromCharCode(b):'.'; }
  return s;
}

for (const e of events) {
  if (e.kind !== 'delete') continue;
  const n = e.aEnd - e.aStart;
  const ctxBefore = Math.min(48, e.aStart);
  console.log(`\nDELETE block (${n}B) at A=0x${e.aStart.toString(16)}`);
  console.log('  ctx-32 BEFORE (save_8):');
  console.log(hex(s8, e.aStart - 32, 32 + n));
  console.log('  ASCII: ', ascii(s8, e.aStart - 32, 32 + n));
  console.log('  ctx-32 AFTER (save_8):');
  console.log(hex(s8, e.aEnd, 32));
  console.log('  ASCII: ', ascii(s8, e.aEnd, 32));
  console.log('  same area in save_9 (bytes around bPos=0x' + e.bPos.toString(16) + '):');
  console.log(hex(s9, Math.max(0, e.bPos - 32), 96));
  console.log('  ASCII: ', ascii(s9, Math.max(0, e.bPos - 32), 96));
}
