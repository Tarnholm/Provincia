// dig-alliance1.js
// save_2.1 → save_3.1 alliance with Messapians (+166KB).
// Find all insert/delete events and group by size to identify the
// "alliance" structures.

const fs = require('fs');
const path = require('path');
const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const s2 = fs.readFileSync(path.join(SAVES_DIR,'save_2.1.sav'));
const s3 = fs.readFileSync(path.join(SAVES_DIR,'save_3.1.sav'));

function alignedDiff(A, B, anchorW=24, maxSkip=8192) {
  const events = [];
  let i = 0, j = 0;
  const lenA = A.length, lenB = B.length;
  let stepsSinceLog = 0;
  while (i < lenA && j < lenB) {
    if (A[i] === B[j]) { i++; j++; if (++stepsSinceLog > 1_000_000) { console.error('  progress i=', i, 'j=', j); stepsSinceLog = 0; } continue; }
    let bestB = -1, bestA = -1;
    for (let dj = 1; dj <= maxSkip && j+dj+anchorW <= lenB && i+anchorW <= lenA; dj++) {
      let ok = true;
      for (let k = 0; k < anchorW; k++) if (A[i+k] !== B[j+dj+k]) { ok = false; break; }
      if (ok) { bestB = dj; break; }
    }
    for (let di = 1; di <= maxSkip && i+di+anchorW <= lenA && j+anchorW <= lenB; di++) {
      let ok = true;
      for (let k = 0; k < anchorW; k++) if (A[i+di+k] !== B[j+k]) { ok = false; break; }
      if (ok) { bestA = di; break; }
    }
    if (bestB > 0 && (bestA < 0 || bestB <= bestA)) {
      events.push({ kind:'insert', bStart: j, bEnd: j+bestB, aPos: i });
      j += bestB;
    } else if (bestA > 0) {
      events.push({ kind:'delete', aStart: i, aEnd: i+bestA, bPos: j });
      i += bestA;
    } else {
      i++; j++;
    }
  }
  if (i < lenA) events.push({ kind: 'delete', aStart: i, aEnd: lenA, bPos: j });
  if (j < lenB) events.push({ kind: 'insert', bStart: j, bEnd: lenB, aPos: i });
  return events;
}

console.log('save_2 size:', s2.length, 'save_3 size:', s3.length, 'netΔ:', s3.length - s2.length);
console.log('Computing diff (slow, may take 30-60s)...');
const events = alignedDiff(s2, s3);

let inserts=0, deletes=0, insBytes=0, delBytes=0;
const insArr=[], delArr=[];
for (const e of events) {
  if (e.kind==='insert') { inserts++; const n=e.bEnd-e.bStart; insBytes+=n; insArr.push({...e,len:n}); }
  else { deletes++; const n=e.aEnd-e.aStart; delBytes+=n; delArr.push({...e,len:n}); }
}
console.log(`Events: ${events.length}  ins:${inserts} (${insBytes}B)  del:${deletes} (${delBytes}B)  net:${insBytes-delBytes}`);

function hex(buf, off, n=64) {
  const s=[]; for (let i=0;i<n && off+i<buf.length;i++){ s.push(buf[off+i].toString(16).padStart(2,'0')); if ((i+1)%16===0) s.push('\n'); }
  return s.join(' ');
}
function ascii(buf, off, n=64) {
  let s=''; for (let i=0;i<n && off+i<buf.length;i++){ const b=buf[off+i]; s+=(b>=32 && b<127)?String.fromCharCode(b):'.'; }
  return s;
}

insArr.sort((a,b)=>b.len-a.len);
delArr.sort((a,b)=>b.len-a.len);

// Bucket by length
function bucket(arr) {
  const b = {};
  for (const e of arr) {
    const k = e.len;
    b[k] = (b[k] || 0) + 1;
  }
  return b;
}
const insB = bucket(insArr), delB = bucket(delArr);
console.log('\nINSERT length buckets (descending):');
const insSizes = Object.keys(insB).map(Number).sort((a,b)=>b-a);
for (const sz of insSizes.slice(0, 20)) console.log(`  ${sz}B × ${insB[sz]}  (total ${sz*insB[sz]}B)`);

console.log('\nDELETE length buckets (descending):');
const delSizes = Object.keys(delB).map(Number).sort((a,b)=>b-a);
for (const sz of delSizes.slice(0, 20)) console.log(`  ${sz}B × ${delB[sz]}  (total ${sz*delB[sz]}B)`);

console.log('\nTop-10 LARGEST INSERTS:');
for (const e of insArr.slice(0,10)) {
  console.log(`  INSERT @ B=0x${e.bStart.toString(16)}..0x${e.bEnd.toString(16)}  len=${e.len}`);
  console.log('    HEX (first 64B): ' + hex(s3, e.bStart, 64));
  console.log('    ASCII (first 96B): ' + ascii(s3, e.bStart, 96));
}
