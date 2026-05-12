// Start the aligned diff from offset 0 and walk forward fully.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_4.2.sav'));

function eq(a, ai, b, bi, n) {
  for (let i = 0; i < n; i++) if (a[ai+i] !== b[bi+i]) return false;
  return true;
}

let ai = 0, bi = 0;
const inserts = [];
const PROBE = 256;
const start = Date.now();
while (ai < A.length && bi < B.length) {
  if (A[ai] === B[bi]) { ai++; bi++; continue; }
  let found = false;
  // B-side insert
  for (let d = 1; d <= PROBE; d++) {
    if (bi + d + 32 > B.length) break;
    if (eq(A, ai, B, bi + d, 32)) {
      inserts.push({ type: 'INS_B', ai, bi, len: d, content: B.slice(bi, bi+d).toString('hex'), ascii: B.slice(bi, bi+d).toString('latin1').replace(/[^\x20-\x7e]/g, '.') });
      bi += d; found = true; break;
    }
  }
  if (!found) {
    for (let d = 1; d <= PROBE; d++) {
      if (ai + d + 32 > A.length) break;
      if (eq(A, ai + d, B, bi, 32)) {
        inserts.push({ type: 'INS_A', ai, bi, len: d, content: A.slice(ai, ai+d).toString('hex') });
        ai += d; found = true; break;
      }
    }
  }
  if (!found) {
    for (let d = 1; d <= 32; d++) {
      if (ai + d + 32 > A.length || bi + d + 32 > B.length) break;
      if (eq(A, ai + d, B, bi + d, 32)) {
        inserts.push({ type: 'REPL', ai, bi, len: d, A_hex: A.slice(ai, ai+d).toString('hex'), B_hex: B.slice(bi, bi+d).toString('hex') });
        ai += d; bi += d; found = true; break;
      }
    }
  }
  if (!found) {
    inserts.push({ type: 'SKIP', ai, bi, len: 1 });
    ai++; bi++;
  }
  if (inserts.length % 5000 === 0) {
    console.error(`  events=${inserts.length} ai=0x${ai.toString(16)} elapsed=${((Date.now()-start)/1000).toFixed(0)}s`);
  }
}

console.log(`Total events: ${inserts.length}`);
const counts = {};
for (const e of inserts) { counts[e.type] = (counts[e.type]||0) + 1; }
console.log(`By type: ${JSON.stringify(counts)}`);
let netB = 0, netA = 0;
for (const e of inserts) {
  if (e.type === 'INS_B') netB += e.len;
  if (e.type === 'INS_A') netA += e.len;
}
console.log(`Net inserted B: ${netB}; deleted A: ${netA}; B-A: ${netB - netA}; actual: ${B.length - A.length}`);

fs.writeFileSync('C:/dev/Provincia/scripts/save-cracker/out-diplomat-events.json',
                  JSON.stringify(inserts.filter(e => e.type !== 'REPL' || e.len >= 8), null, 1));

console.log('\nAll INS_B and INS_A events:');
for (const e of inserts) {
  if (e.type === 'INS_B' || e.type === 'INS_A') {
    const tag = e.type === 'INS_B' ? '+' : '-';
    console.log(`  ${e.type} A=0x${e.ai.toString(16)} B=0x${e.bi.toString(16)} ${tag}${e.len}`);
    if (e.len <= 96) {
      console.log(`    hex:  ${e.content}`);
      if (e.ascii) console.log(`    asc:  "${e.ascii}"`);
    }
  }
}
