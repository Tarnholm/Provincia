// dig-diplomacy15.js — Session 31: locate major-faction records in save_1 / save_3
// and dump basic stats. Goal: confirm record count + identify Romans Julii and
// Messapians records by region-list fingerprint and treasury.

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
    const snapshot = buf.readInt32LE(i + 92 + 4 * regions);
    out.push({ pos: i, treasury, snapshot, regions });
    i += 60; // skip a bit
  }
  return out;
}

function load(p) {
  const buf = fs.readFileSync(p);
  return { buf, recs: findMajorRecords(buf) };
}

const A = load(SAVE_A);
const B = load(SAVE_B);

console.log("=== SAVE A (save_1, BEFORE) ===");
console.log("file size:", A.buf.length);
console.log("major records:", A.recs.length);
for (const r of A.recs) {
  console.log(`  pos=0x${r.pos.toString(16)} regions=${r.regions} treasury=${r.treasury} snapshot=${r.snapshot}`);
}

console.log("\n=== SAVE B (save_3, AFTER) ===");
console.log("file size:", B.buf.length);
console.log("major records:", B.recs.length);
for (const r of B.recs) {
  console.log(`  pos=0x${r.pos.toString(16)} regions=${r.regions} treasury=${r.treasury} snapshot=${r.snapshot}`);
}

// Region fingerprints for index alignment between A and B (region list is static)
function regionList(buf, pos, N) {
  const arr = [];
  for (let k = 0; k < N; k++) arr.push(buf.readUInt32LE(pos + 52 + k * 4));
  return arr.slice().sort((x, y) => x - y).join(",");
}

console.log("\n=== Region-list fingerprints ===");
const fingerA = new Map();
for (let idx = 0; idx < A.recs.length; idx++) {
  const r = A.recs[idx];
  fingerA.set(regionList(A.buf, r.pos, r.regions), { idx, r });
}
const fingerB = new Map();
for (let idx = 0; idx < B.recs.length; idx++) {
  const r = B.recs[idx];
  fingerB.set(regionList(B.buf, r.pos, r.regions), { idx, r });
}

console.log("matched fingerprints:");
let matchN = 0;
for (const [fp, a] of fingerA) {
  if (fingerB.has(fp)) {
    matchN++;
    const b = fingerB.get(fp);
    const sample = fp.split(",").slice(0, 4).join(",");
    console.log(`  A[${a.idx}]:0x${a.r.pos.toString(16)}(${a.r.regions}r,$${a.r.treasury}) <-> B[${b.idx}]:0x${b.r.pos.toString(16)}(${b.r.regions}r,$${b.r.treasury})  first4=${sample}`);
  }
}
console.log(`${matchN}/${A.recs.length} fingerprints match A↔B`);

// Print Romans Julii (35 regions) and Messapians records — both should be majors
// Romans Julii's expected fingerprint includes region "Latium" etc.; we'll find
// it by treasury / region count distinguishing.
const ROMAN_HOMELAND = [436, 437, 462, 467, 481, 486, 496, 497, 508, 530, 536, 580, 592, 698, 798, 818, 922, 949, 969, 994, 1002, 1003, 1011, 1019, 1024, 1025, 1026, 1042, 1047, 1056, 1057, 1071, 1074, 1078, 1089].join(",");
console.log("\n=== Romans Julii lookup (35-region homeland from sessions 5/9) ===");
for (const [fp, info] of fingerA) {
  if (fp === ROMAN_HOMELAND) {
    console.log(`  A index ${info.idx} matches Romans Julii fingerprint`);
  }
}
for (const [fp, info] of fingerB) {
  if (fp === ROMAN_HOMELAND) {
    console.log(`  B index ${info.idx} matches Romans Julii fingerprint`);
  }
}
