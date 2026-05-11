// dig-siege5.js
// Find the Brundisium siege block in save_7 (vs save_6 which has no siege).
// The expected structure (from save_8 vs save_9):
//   Block A (4 bytes): a u32 reference pointing into a UUID, inserted near
//                      an existing UUID-bearing record at offset ~0x12d8724
//   Block B (13 bytes): `01 [12-byte UUID]` — a "siege header" block
//                       inserted at some offset
//   Block C (56 bytes): zeros + u32 + zeros — the siege payload
//
// Strategy: use the precise aligned diff to find ALL deletes/inserts
// between save_6 and save_7, then identify the 73-byte total insert.

const fs = require('fs');
const path = require('path');

const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const s6 = fs.readFileSync(path.join(SAVES_DIR,'save_6.1.sav'));
const s7 = fs.readFileSync(path.join(SAVES_DIR,'save_7.1.sav'));

function alignedDiff(A, B, anchorW=16, maxSkip=512) {
  const events = [];
  let i = 0, j = 0;
  const lenA = A.length, lenB = B.length;
  while (i < lenA && j < lenB) {
    if (A[i] === B[j]) { i++; j++; continue; }
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

console.log('Aligned diff save_6 → save_7 (siege of Brundisium STARTS, expected +73B)...');
console.log('save_6 size:', s6.length, 'save_7 size:', s7.length, 'netΔ:', s7.length - s6.length);

const events = alignedDiff(s6, s7, 16, 1024);
let inserts=0, deletes=0, insBytes=0, delBytes=0;
const insArr = [], delArr = [];
for (const e of events) {
  if (e.kind==='insert') { inserts++; const n=e.bEnd-e.bStart; insBytes+=n; insArr.push({...e,len:n}); }
  else if (e.kind==='delete') { deletes++; const n=e.aEnd-e.aStart; delBytes+=n; delArr.push({...e,len:n}); }
}
console.log(`Events: ${events.length}  ins:${inserts} (${insBytes}B)  del:${deletes} (${delBytes}B)  net:${insBytes-delBytes}`);

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

console.log('\nAll INSERT events (sorted by length desc):');
insArr.sort((a,b)=>b.len-a.len);
for (const e of insArr.slice(0, 20)) {
  console.log(`  INSERT @ B=0x${e.bStart.toString(16)}..0x${e.bEnd.toString(16)}  len=${e.len}  aPos=0x${e.aPos.toString(16)}`);
  if (e.len <= 80) {
    console.log('    HEX: ' + hex(s7, e.bStart, e.len));
    console.log('    ASCII: ' + ascii(s7, e.bStart, e.len));
  }
}
console.log('\nAll DELETE events (sorted by length desc):');
delArr.sort((a,b)=>b.len-a.len);
for (const e of delArr.slice(0, 10)) {
  console.log(`  DELETE @ A=0x${e.aStart.toString(16)}..0x${e.aEnd.toString(16)}  len=${e.len}  bPos=0x${e.bPos.toString(16)}`);
  if (e.len <= 80) {
    console.log('    HEX: ' + hex(s6, e.aStart, e.len));
  }
}
