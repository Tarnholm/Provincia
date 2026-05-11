// dig-diplomacy17.js — Build a complete A↔B mapping including duplicate fingerprints.

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
    const treasury = buf.readInt32LE(i);
    const list = [];
    for (let k = 0; k < regions; k++) list.push(buf.readUInt32LE(i + 52 + k * 4));
    out.push({ pos: i, treasury, regions, fp: list.slice().sort((a,b)=>a-b).join(",") });
    i += 60;
  }
  return out;
}

const A = { buf: fs.readFileSync(SAVE_A) };
A.recs = findMajorRecords(A.buf);
const B = { buf: fs.readFileSync(SAVE_B) };
B.recs = findMajorRecords(B.buf);

console.log("save_1 records:", A.recs.length, "  save_3 records:", B.recs.length);

// duplicates
const aDupes = new Map();
for (let i = 0; i < A.recs.length; i++) {
  const fp = A.recs[i].fp;
  if (!aDupes.has(fp)) aDupes.set(fp, []);
  aDupes.get(fp).push(i);
}
for (const [fp, ixs] of aDupes) {
  if (ixs.length > 1) console.log(`A duplicate fingerprint at indices [${ixs.join(",")}] — fp starts ${fp.slice(0, 30)}…`);
}

// match each A record to the most-similar B record (by fingerprint)
const usedB = new Set();
console.log("\n=== A→B alignment ===");
for (let ai = 0; ai < A.recs.length; ai++) {
  const a = A.recs[ai];
  let bestBi = -1;
  for (let bi = 0; bi < B.recs.length; bi++) {
    if (usedB.has(bi)) continue;
    if (B.recs[bi].fp === a.fp) { bestBi = bi; break; }
  }
  if (bestBi >= 0) {
    usedB.add(bestBi);
    const b = B.recs[bestBi];
    console.log(`  A[${ai}](r=${a.regions},$${a.treasury}) → B[${bestBi}](r=${b.regions},$${b.treasury})  Δ$=${b.treasury - a.treasury}  posΔ=0x${(b.pos - a.pos).toString(16)}`);
  } else {
    console.log(`  A[${ai}](r=${a.regions},$${a.treasury}) → NO MATCH`);
  }
}
