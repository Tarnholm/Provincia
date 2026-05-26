// dig-reputation-07-smallint.js
// Re-diff T4start -> T4war (the betrayal) but report ONLY small-integer byte
// changes (both old & new < 64) and ONLY at offsets that are NOT part of a
// 4-byte UUID churn. Heuristic for "UUID churn": a run of >=4 consecutive
// changed bytes where values look random. We keep ISOLATED small-int changes.
//
// Goal: find a bounded scalar (reputation/standing) that changes for the
// player's record (and maybe Carthage's) but stays constant for unrelated
// factions.

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
    out.push({ off: i, treasury: buf.readInt32LE(i) });
  }
  return out;
}

const ra = findRecs(A), rb = findRecs(B);

function bodySize(recs, idx, buflen) {
  const cur = recs[idx].off;
  const next = idx + 1 < recs.length ? recs[idx + 1].off : Math.min(buflen, cur + 8192);
  return Math.min(next - cur, 8192);
}

const usedB = new Set();
for (let ai = 0; ai < ra.length; ai++) {
  const a = ra[ai];
  let bi = rb.findIndex((b, k) => !usedB.has(k) && b.treasury === a.treasury);
  if (bi < 0) continue;
  usedB.add(bi);
  const b = rb[bi];
  const n = Math.min(bodySize(ra, ai, A.length), bodySize(rb, bi, B.length));

  // Build a changed-mask, then find isolated small-int changes:
  // an offset o where A[o]!=B[o], both <64, and the immediate neighbors
  // (o-1,o+1) are NOT part of a >=3-long changed run (to exclude UUID churn).
  const changed = new Array(n).fill(false);
  for (let o = 0; o < n; o++) changed[o] = A[a.off + o] !== B[b.off + o];

  const reports = [];
  for (let o = 0; o < n; o++) {
    if (!changed[o]) continue;
    const av = A[a.off + o], bv = B[b.off + o];
    if (av >= 64 || bv >= 64) continue;
    // measure changed-run length around o
    let l = o; while (l > 0 && changed[l - 1]) l--;
    let r = o; while (r < n - 1 && changed[r + 1]) r++;
    const runLen = r - l + 1;
    if (runLen > 2) continue; // part of a multi-byte churn (likely UUID)
    reports.push({ o, av, bv, runLen });
  }
  if (reports.length) {
    console.log(`\nrec[${ai}] A@0x${a.off.toString(16)} treas=${a.treasury}  isolated small-int diffs:`);
    for (const rp of reports) {
      console.log(`    +${String(rp.o).padStart(4)}: ${rp.av} -> ${rp.bv}   (run=${rp.runLen})`);
    }
  } else {
    console.log(`\nrec[${ai}] treas=${a.treasury}: no isolated small-int diffs`);
  }
}
