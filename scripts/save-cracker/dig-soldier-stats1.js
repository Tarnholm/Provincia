// dig-soldier-stats1.js — Find unit records in the tail field-army block.
// Per session 22/23: tail block at 0x1f10c72..0x1f43598 contains 122 unit records;
// schema: [u16 nameLen][ASCII unit name][0xee][8B][8B][0x0001012c][...][N × 9B soldier records][0xff padding].
// Hypothesis: byte 0..2 of each 9-byte soldier record encodes HP/kills/XP.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

// The tail block offset will differ per save. Need to locate it.
// Per session 22: starts at 0x1f10c72 in rome10. Likely shifted in this save.
// Locator: find the unique 0x0001012c (76860) magic.
const TAG = 0x0001012c;
function findAllU32(buf, val) {
  const out = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === val) out.push(i);
  }
  return out;
}

console.log("locating 0x0001012c tag...");
const hitsA = findAllU32(bA, TAG);
const hitsB = findAllU32(bB, TAG);
console.log(`A: ${hitsA.length}  B: ${hitsB.length}`);

// Group hits by clusters (gaps > 1MB indicate different blocks)
function cluster(hits) {
  const clusters = [];
  for (const h of hits) {
    if (clusters.length && h - clusters[clusters.length-1].end < 100000) {
      clusters[clusters.length-1].end = h;
      clusters[clusters.length-1].count++;
    } else {
      clusters.push({ start: h, end: h, count: 1 });
    }
  }
  return clusters;
}

const cA = cluster(hitsA);
const cB = cluster(hitsB);
console.log("\nClusters in A:");
for (const c of cA) console.log(`  0x${c.start.toString(16)}..0x${c.end.toString(16)} count=${c.count}`);
console.log("Clusters in B:");
for (const c of cB) console.log(`  0x${c.start.toString(16)}..0x${c.end.toString(16)} count=${c.count}`);

// The largest tail cluster is the field-army block. Get its starting offset.
const tailA = cA.reduce((a, b) => b.count > a.count ? b : a);
const tailB = cB.reduce((a, b) => b.count > a.count ? b : a);
console.log(`\nField-army block A: 0x${tailA.start.toString(16)}..0x${tailA.end.toString(16)}`);
console.log(`Field-army block B: 0x${tailB.start.toString(16)}..0x${tailB.end.toString(16)}`);

// Now walk records in each. Each record:
//  [u16 nameLen][ASCII name][0xee][8B hash][8B uuid][u32 0x0001012c][u32 0x1][u16 settLen][UTF-16 settlement]...
// Find back from the tag.
function walkRecords(buf, tailStart) {
  const records = [];
  let i = tailStart;
  // back up to find first record's name length prefix
  // Easier: scan forward from a known offset (~0x1f10c72 in rome10 or some range)
  // Let's scan the whole block. Each record's tag is at some offset within it.
  // Algorithm: at each tag location, work backwards to find the name's 0xee terminator.
  for (let t = tailStart - 50000; t < tailStart + 1000000 && t + 4 < buf.length; t++) {
    if (buf.readUInt32LE(t) !== 0x0001012c) continue;
    if (buf.readUInt32LE(t + 4) !== 1) continue;
    // Found a tag. Walk back to find 0xee marker.
    let ee = -1;
    for (let k = t - 1; k > t - 50; k--) {
      if (buf[k] === 0xee && buf[k+1] !== 0xee) {
        // Need to check: bytes after 0xee should be 16 bytes of hash, then tag.
        if (k + 1 + 16 === t) { ee = k; break; }
      }
    }
    if (ee === -1) continue;
    // Find name length: look back from ee for u16 nameLen
    // Name length is at some position N; bytes N+2..N+2+len = ASCII name, then 0xee at N+2+len.
    // Try plausible lengths.
    let nameLen = -1, nameStart = -1;
    for (let nl = 5; nl < 40; nl++) {
      const ns = ee - nl;
      if (ns - 2 < 0) continue;
      if (buf.readUInt16LE(ns - 2) === nl) {
        // Check chars are ASCII
        let ok = true;
        for (let c = 0; c < nl; c++) {
          const b = buf[ns + c];
          if (b < 0x20 || b > 0x7e) { ok = false; break; }
        }
        if (ok) { nameLen = nl; nameStart = ns; break; }
      }
    }
    if (nameLen === -1) continue;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString("ascii");
    records.push({ start: nameStart - 2, nameLen, name, tagOff: t });
  }
  return records;
}

console.log("\nScanning A records...");
const recsA = walkRecords(bA, tailA.start);
console.log(`Found ${recsA.length} A records`);
console.log("\nScanning B records...");
const recsB = walkRecords(bB, tailB.start);
console.log(`Found ${recsB.length} B records`);

console.log("\n=== First 30 A records ===");
for (let i = 0; i < Math.min(30, recsA.length); i++) {
  console.log(`  [${i}] 0x${recsA[i].start.toString(16)}: "${recsA[i].name}"`);
}
console.log("\n=== First 30 B records ===");
for (let i = 0; i < Math.min(30, recsB.length); i++) {
  console.log(`  [${i}] 0x${recsB[i].start.toString(16)}: "${recsB[i].name}"`);
}

// Look for differences
const namesA = recsA.map(r => r.name);
const namesB = recsB.map(r => r.name);
console.log("\nA name multiset vs B name multiset:");
const countA = new Map();
for (const n of namesA) countA.set(n, (countA.get(n) || 0) + 1);
const countB = new Map();
for (const n of namesB) countB.set(n, (countB.get(n) || 0) + 1);
const allNames = new Set([...countA.keys(), ...countB.keys()]);
for (const n of allNames) {
  const a = countA.get(n) || 0;
  const b = countB.get(n) || 0;
  if (a !== b) console.log(`  "${n}": A=${a} B=${b}`);
}
