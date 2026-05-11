// dig-diplomacy27.js — Within each faction record, find bytes that DIFFER between
// save_1 and save_3. Then compare: bytes that change ONLY in Romans Julii (idx 0)
// AND in Messapians (idx 20), but DO NOT change in other AI-only factions.
//
// Tactic: align faction records by INDEX (positional) and read +52+4N+K for
// each. Look at K values 0..2000 and find "K where ONLY Romans and Messapians changed".

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

function findMajor(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
    i += 60;
  }
  return out;
}

const recsA = findMajor(bA);
const recsB = findMajor(bB);
console.log(`A records: ${recsA.length}  B records: ${recsB.length}`);

// For each index, compute the post-region-list start
// then iterate through bytes (up to 2000) and check if A[pos+offset] != B[pos+offset]
// across each index.

// Track which indices change at offset K. Useful: K such that ONLY idx=0 (Romans) and idx=20 (Messapians) flip.

const N = recsA.length;
const MAX_K = 1500;
const changeByK = new Array(MAX_K).fill(0).map(() => new Set());

for (let k = 0; k < MAX_K; k++) {
  for (let i = 0; i < N; i++) {
    const a = recsA[i];
    const b = recsB[i];
    const offA = a.pos + 52 + 4 * a.regions + k;
    const offB = b.pos + 52 + 4 * b.regions + k;
    if (offA >= bA.length || offB >= bB.length) continue;
    if (bA[offA] !== bB[offB]) changeByK[k].add(i);
  }
}

// For each K, identify the "signature" — which indices changed
const sigToKs = new Map();
for (let k = 0; k < MAX_K; k++) {
  const sig = Array.from(changeByK[k]).sort((a, b) => a - b).join(',');
  if (!sigToKs.has(sig)) sigToKs.set(sig, []);
  sigToKs.get(sig).push(k);
}

// Print signatures sorted by frequency (most rare signatures first since they're more meaningful)
const sorted = Array.from(sigToKs.entries()).sort((a, b) => a[1].length - b[1].length);

console.log("\n=== Change signatures by K (offset post-regionlist) ===");
console.log("Looking for: {0 (Romans), 20 (Messapians)} or {0} or {20}");
for (const [sig, ks] of sorted) {
  if (sig === '') continue;
  if (sig === '0' || sig === '20' || sig === '0,20' || sig.split(',').length <= 3) {
    console.log(`  sig=[${sig}]  count=${ks.length}  Ks: ${ks.slice(0, 30).map(k => k).join(',')}${ks.length>30?'...':''}`);
  }
}

// Print top-most-frequent signatures too
console.log("\n=== Most common change signatures (showing top 20) ===");
const sortedByFreq = Array.from(sigToKs.entries()).sort((a, b) => b[1].length - a[1].length);
for (const [sig, ks] of sortedByFreq.slice(0, 20)) {
  if (sig === '') continue;
  console.log(`  sig=[${sig}] (${sig.split(',').length} factions)  count=${ks.length}  first K: ${ks.slice(0,5).join(',')}`);
}
