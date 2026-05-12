// Goal #3: save_1.2 -> save_2.2 (+166KB, queue stone wall).
// Run the aligned diff and look for SMALL structural inserts (<200B)
// to identify the build queue entry vs AI noise.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_1.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));

console.log(`A=save_1.2 (${A.length}B)  B=save_2.2 (${B.length}B)  ΔlenB-A=${B.length-A.length}`);

function eq(a, ai, b, bi, n) {
  for (let i = 0; i < n; i++) if (a[ai+i] !== b[bi+i]) return false;
  return true;
}

let ai = 0, bi = 0;
const inserts = [];
const PROBE = 512;
const start = Date.now();
while (ai < A.length && bi < B.length) {
  if (A[ai] === B[bi]) { ai++; bi++; continue; }
  let found = false;
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
        inserts.push({ type: 'REPL', ai, bi, len: d });
        ai += d; bi += d; found = true; break;
      }
    }
  }
  if (!found) {
    inserts.push({ type: 'SKIP', ai, bi, len: 1 });
    ai++; bi++;
  }
  if (inserts.length % 10000 === 0) {
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
console.log(`Net: ${netB - netA} (actual: ${B.length - A.length})`);

// Filter for small inserts (4..200 B) which are likely structural
const small = inserts.filter(e =>
  (e.type === 'INS_A' || e.type === 'INS_B') && e.len >= 4 && e.len <= 200);
console.log(`\nSmall (4..200B) structural events: ${small.length}`);
for (const e of small) {
  const tag = e.type === 'INS_B' ? '+' : '-';
  console.log(`  ${e.type} A=0x${e.ai.toString(16).padStart(8,'0')} B=0x${e.bi.toString(16).padStart(8,'0')} ${tag}${e.len}`);
  if (e.content) console.log(`    hex:  ${e.content.slice(0, 220)}`);
  if (e.ascii) console.log(`    asc:  "${e.ascii.slice(0, 120)}"`);
}

fs.writeFileSync('C:/dev/Provincia/scripts/save-cracker/out-queue-build-events.json',
                  JSON.stringify(inserts.filter(e => e.type !== 'REPL'), null, 1));
