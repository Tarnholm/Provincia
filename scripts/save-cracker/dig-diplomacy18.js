// dig-diplomacy18.js — Diff Romans Julii (idx=0) and Messapians (idx=20) records
// between save_1 (BEFORE peace) and save_3 (AFTER war). Find bytes that differ
// in BOTH and also bytes that ONLY differ between them and NOT in some
// unaffected pair (e.g. carthage idx=1).

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

function findMajorRecords(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions, treasury: buf.readInt32LE(i) });
    i += 60;
  }
  return out;
}

const A = { buf: fs.readFileSync(SAVE_A) };
A.recs = findMajorRecords(A.buf);
const B = { buf: fs.readFileSync(SAVE_B) };
B.recs = findMajorRecords(B.buf);

// Compute end of each record (next record's start or some bound).
function recEndA(i) {
  if (i + 1 < A.recs.length) return A.recs[i + 1].pos;
  return A.recs[i].pos + 250000;
}
function recEndB(i) {
  if (i + 1 < B.recs.length) return B.recs[i + 1].pos;
  return B.recs[i].pos + 250000;
}

function recBytes(buf, start, end) {
  return buf.subarray(start, end);
}

function diffRegions(bytesA, bytesB) {
  // Returns array of {start,len} where bytes differ.
  const n = Math.min(bytesA.length, bytesB.length);
  const diffs = [];
  let i = 0;
  while (i < n) {
    if (bytesA[i] !== bytesB[i]) {
      const start = i;
      while (i < n && bytesA[i] !== bytesB[i]) i++;
      diffs.push({ start, len: i - start });
    } else i++;
  }
  if (bytesA.length !== bytesB.length) diffs.push({ start: n, len: Math.abs(bytesA.length - bytesB.length), trailing: true });
  return diffs;
}

const idxs = [0, 20, 1, 2, 14]; // Romans, Messapians, two controls (carthage = idx 1, ptolemaic-like idx 2, italian-ish idx 14)
for (const idx of idxs) {
  const a = A.recs[idx], b = B.recs[idx];
  const ba = recBytes(A.buf, a.pos, recEndA(idx));
  const bb = recBytes(B.buf, b.pos, recEndB(idx));
  const diffs = diffRegions(ba, bb);
  console.log(`\n=== record idx=${idx}  A.size=${ba.length}  B.size=${bb.length}  diffs=${diffs.length} ===`);
  // small regions
  const small = diffs.filter(d => !d.trailing && d.len < 256);
  console.log(`  small diff regions (<256 B): ${small.length}`);
  for (const d of small.slice(0, 50)) {
    const head = ba.subarray(d.start, d.start + Math.min(d.len, 16)).toString("hex");
    const head2 = bb.subarray(d.start, d.start + Math.min(d.len, 16)).toString("hex");
    console.log(`    rel+0x${d.start.toString(16)}  len=${d.len}  A:${head}  B:${head2}`);
  }
  const big = diffs.filter(d => !d.trailing && d.len >= 256);
  console.log(`  big diff regions (>=256 B): ${big.length}`);
  for (const d of big.slice(0, 5)) {
    console.log(`    rel+0x${d.start.toString(16)}  len=${d.len}`);
  }
}
