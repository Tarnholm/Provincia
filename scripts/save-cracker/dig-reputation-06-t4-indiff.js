// dig-reputation-06-t4-indiff.js
// THE controlled betrayal experiment.
// T4start  -> T4war  is a single in-turn action: Spain declares war on
// Carthage (breaking the T2 trade agreement = a betrayal). Same turn, so
// treasuries are identical and the file grows only slightly. Diffing the two
// isolates the war declaration. If reputation/standing is stored per-faction,
// Spain's (and possibly Carthage's) record should show a small scalar change.
//
// Records are matched across the two saves by TREASURY (id28 is a per-session
// handle, but treasury is identical in this in-turn pair).
//
// We dump, per matched record, every byte offset (relative to record start)
// in the first 2048 bytes that DIFFERS, with old/new values.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const B = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav'));

function findRecs(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    out.push({ off: i, treasury: buf.readInt32LE(i), p44: buf.readUInt32LE(i + 44) });
  }
  return out;
}

const ra = findRecs(A), rb = findRecs(B);
console.log(`T4start: ${ra.length} records   T4war: ${rb.length} records`);

// Determine record body size = distance to next record (approx).
function bodySize(recs, idx, buflen) {
  const cur = recs[idx].off;
  const next = idx + 1 < recs.length ? recs[idx + 1].off : Math.min(buflen, cur + 4096);
  return Math.min(next - cur, 4096);
}

// Match by treasury (unique enough in this in-turn pair). If duplicate
// treasuries, match by order among the duplicates.
const usedB = new Set();
for (let ai = 0; ai < ra.length; ai++) {
  const a = ra[ai];
  let bi = rb.findIndex((b, k) => !usedB.has(k) && b.treasury === a.treasury);
  if (bi < 0) { console.log(`\nrec[${ai}] treas=${a.treasury}: NO MATCH in T4war`); continue; }
  usedB.add(bi);
  const b = rb[bi];
  const sizeA = bodySize(ra, ai, A.length);
  const sizeB = bodySize(rb, bi, B.length);
  const n = Math.min(sizeA, sizeB);
  const diffs = [];
  for (let o = 0; o < n; o++) {
    if (A[a.off + o] !== B[b.off + o]) diffs.push(o);
  }
  // Skip the self-pointer fields (+24,+25,+26,+27,+40..+43) which always
  // differ because the record moved. Also skip +28 (handle).
  const skip = new Set();
  for (const s of [24,25,26,27,40,41,42,43,28,29,30,31,4,5,6,7]) skip.add(s);
  const real = diffs.filter(o => !skip.has(o));
  console.log(`\nrec[${ai}] A@0x${a.off.toString(16)} B@0x${b.off.toString(16)} treas=${a.treasury} p44=${a.p44} bodyN=${n} totalDiffs=${diffs.length} (non-ptr=${real.length})`);
  // Group consecutive offsets into ranges and print old/new
  for (const o of real) {
    console.log(`    +${String(o).padStart(4)}: ${A[a.off+o].toString(16).padStart(2,'0')} -> ${B[b.off+o].toString(16).padStart(2,'0')}`);
  }
}
