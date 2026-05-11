// dig-siege2.js
// Find the +73 insert in save_6 → save_7 and -73 delete in save_8 → save_9.
// Approach: do a Myers-style 2-pointer diff with anchor windows. Whenever
// A and B match for K bytes in a row, fast-forward both. When they
// diverge, scan ahead in B for the next anchor match in A; the gap is the
// insert.

const fs = require('fs');
const path = require('path');

const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

function loadSave(f) { return fs.readFileSync(path.join(SAVES_DIR,f)); }

const ANCHOR = 32;     // bytes of matching context to declare an anchor
const SCAN_AHEAD = 4096; // how far to scan B for next anchor when A diverges

function findInsertRegion(A, B) {
  // A is shorter or longer than B; find regions where B has bytes A doesn't.
  // We'll return an array of { aPos, bStart, bEnd, kind: 'insert'|'delete'|'modify' }
  // Simplistic: walk pointer i in A, j in B.
  const events = [];
  let i = 0, j = 0;
  const lenA = A.length, lenB = B.length;
  let diffStreak = 0;
  let diffStartA = -1, diffStartB = -1;
  while (i < lenA && j < lenB) {
    if (A[i] === B[j]) {
      if (diffStreak > 0) {
        // Close out the run before this match
        events.push({ kind:'diff', aStart: diffStartA, aEnd: i, bStart: diffStartB, bEnd: j });
        diffStreak = 0;
        diffStartA = diffStartB = -1;
      }
      i++; j++;
    } else {
      // Try to find next ANCHOR-match window
      let bestSkipB = -1, bestSkipA = -1, bestK = 0;
      // Try aligning ahead in B (insert in B)
      for (let k = 1; k < SCAN_AHEAD && j + k + ANCHOR <= lenB && i + ANCHOR <= lenA; k++) {
        // Check if A[i..i+ANCHOR] == B[j+k..j+k+ANCHOR]
        let ok = true;
        for (let t = 0; t < ANCHOR; t++) {
          if (A[i+t] !== B[j+k+t]) { ok=false; break; }
        }
        if (ok) { bestSkipB = k; break; }
      }
      // Try aligning ahead in A (insert in A / delete in B)
      let aSkip = -1;
      for (let k = 1; k < SCAN_AHEAD && i + k + ANCHOR <= lenA && j + ANCHOR <= lenB; k++) {
        let ok = true;
        for (let t = 0; t < ANCHOR; t++) {
          if (A[i+k+t] !== B[j+t]) { ok=false; break; }
        }
        if (ok) { aSkip = k; break; }
      }
      // Choose smaller skip (closer alignment)
      if (bestSkipB > 0 && (aSkip < 0 || bestSkipB <= aSkip)) {
        // Insert in B: B gains `bestSkipB` bytes between j and j+bestSkipB
        events.push({ kind:'insertInB', aPos: i, bStart: j, bEnd: j + bestSkipB });
        j += bestSkipB;
      } else if (aSkip > 0) {
        events.push({ kind:'deleteFromA', aStart: i, aEnd: i + aSkip, bPos: j });
        i += aSkip;
      } else {
        // No alignment found in window — record byte-substitution and step both
        if (diffStreak === 0) { diffStartA = i; diffStartB = j; }
        diffStreak++;
        i++; j++;
        if (diffStreak > SCAN_AHEAD) {
          events.push({ kind:'mismatch', aStart: diffStartA, aEnd: i, bStart: diffStartB, bEnd: j });
          diffStreak = 0;
        }
      }
    }
  }
  // Any tail
  if (i < lenA || j < lenB) {
    events.push({ kind:'tail', aStart: i, aEnd: lenA, bStart: j, bEnd: lenB });
  }
  return events;
}

function hex(buf, off, n) {
  const s=[]; for (let i = 0; i < n && off+i < buf.length; i++) s.push(buf[off+i].toString(16).padStart(2,'0'));
  return s.join(' ');
}
function ascii(buf, off, n) {
  let s=''; for (let i=0;i<n && off+i < buf.length;i++){ const b=buf[off+i]; s+=(b>=32 && b<127)?String.fromCharCode(b):'.'; }
  return s;
}

function reportEvents(label, A, B, events) {
  console.log(`\n=== ${label} ===`);
  // Aggregate
  let inserts = 0, deletes = 0, mods = 0;
  let insBytes = 0, delBytes = 0, modBytes = 0;
  const inserts_arr = [], deletes_arr = [], mods_arr = [];
  for (const e of events) {
    if (e.kind==='insertInB') { inserts++; const n=e.bEnd-e.bStart; insBytes+=n; inserts_arr.push({...e,len:n}); }
    else if (e.kind==='deleteFromA') { deletes++; const n=e.aEnd-e.aStart; delBytes+=n; deletes_arr.push({...e,len:n}); }
    else if (e.kind==='mismatch') { mods++; const n=e.aEnd-e.aStart; modBytes+=n; mods_arr.push({...e,len:n}); }
    else if (e.kind==='diff') { mods++; const n=e.aEnd-e.aStart; modBytes+=n; mods_arr.push({...e,len:n}); }
    else if (e.kind==='tail') { console.log(`  tail: A[${e.aStart}..${e.aEnd}) (${e.aEnd-e.aStart}B), B[${e.bStart}..${e.bEnd}) (${e.bEnd-e.bStart}B)`); }
  }
  console.log(`  inserts=${inserts} (${insBytes}B), deletes=${deletes} (${delBytes}B), mods=${mods} (${modBytes}B)  netΔ=${B.length-A.length}`);
  // Sort by size desc
  inserts_arr.sort((x,y)=>y.len-x.len);
  deletes_arr.sort((x,y)=>y.len-x.len);
  mods_arr.sort((x,y)=>y.len-x.len);
  console.log(`  Top-5 inserts:`);
  for (const e of inserts_arr.slice(0,5)) {
    console.log(`    bStart=0x${e.bStart.toString(16)}  bEnd=0x${e.bEnd.toString(16)}  len=${e.len}`);
    console.log('    HEX(B): ' + hex(B, e.bStart, Math.min(96,e.len)));
    console.log('    ASCII : ' + ascii(B, e.bStart, Math.min(96,e.len)));
  }
  console.log(`  Top-5 deletes:`);
  for (const e of deletes_arr.slice(0,5)) {
    console.log(`    aStart=0x${e.aStart.toString(16)}  aEnd=0x${e.aEnd.toString(16)}  len=${e.len}`);
    console.log('    HEX(A): ' + hex(A, e.aStart, Math.min(96,e.len)));
    console.log('    ASCII : ' + ascii(A, e.aStart, Math.min(96,e.len)));
  }
  console.log(`  Top-5 mods (byte substitutions):`);
  for (const e of mods_arr.slice(0,5)) {
    console.log(`    A:0x${e.aStart.toString(16)} B:0x${e.bStart.toString(16)} len=${e.len}`);
  }
}

console.log('Loading save_6.1.sav...');
const s6 = loadSave('save_6.1.sav');
console.log('Loading save_7.1.sav...');
const s7 = loadSave('save_7.1.sav');
console.log('Loading save_8.1.sav...');
const s8 = loadSave('save_8.1.sav');
console.log('Loading save_9.1.sav...');
const s9 = loadSave('save_9.1.sav');

console.log('Diffing save_6 → save_7 (Brundisium siege START, expected +73)...');
const ev67 = findInsertRegion(s6, s7);
reportEvents('save_6.1 → save_7.1  (Brundisium SIEGE START, +73B)', s6, s7, ev67);

console.log('\nDiffing save_8 → save_9 (Tarentum siege STOP, expected -73)...');
const ev89 = findInsertRegion(s8, s9);
reportEvents('save_8.1 → save_9.1  (Tarentum SIEGE STOP, -73B)', s8, s9, ev89);
