// dig-factail-session46-1.js — Session 46 attempt 1: decode bytes AFTER the
// per-faction AI-policy array sentinel (0x1e) in major faction record.
//
// Method: locate faction 0 (Romans Julii) in each of the 3 saves (T1, stone_wall
// queued, levies queued). Walk past +48=count, past the u32[N] array, past the
// 0x1e sentinel. Compare the next ~200 bytes across all 3 saves.
//
// The only difference: Roma's build queue. So a building/recruitment field in
// faction record should change between saves.

const fs = require("fs");
const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const S1 = `${ROME_DIR}/save_1.2.sav`;   // T1 baseline
const S2 = `${ROME_DIR}/save_2.2.sav`;   // stone_wall queued in Roma
const S3 = `${ROME_DIR}/save_3.2.sav`;   // levies queued in Roma

const b1 = fs.readFileSync(S1);
const b2 = fs.readFileSync(S2);
const b3 = fs.readFileSync(S3);

function findMajors(buf) {
  const out = [];
  for (let p = 0; p < buf.length - 64; p += 4) {
    if (buf.readUInt32LE(p + 8) !== 100) continue;
    if (buf.readUInt32LE(p + 12) !== 1) continue;
    if (buf.readUInt32LE(p + 44) !== 6) continue;
    if (buf.readUInt32LE(p + 24) !== p + 24) continue;
    if (buf.readUInt32LE(p + 40) !== p + 40) continue;
    out.push(p);
  }
  return out;
}

const m1 = findMajors(b1);
const m2 = findMajors(b2);
const m3 = findMajors(b3);

console.log(`m1: ${m1.length} majors @ ${m1.slice(0,3).map(x=>"0x"+x.toString(16)).join(", ")}...`);
console.log(`m2: ${m2.length} majors @ ${m2.slice(0,3).map(x=>"0x"+x.toString(16)).join(", ")}...`);
console.log(`m3: ${m3.length} majors @ ${m3.slice(0,3).map(x=>"0x"+x.toString(16)).join(", ")}...`);

function tailStart(buf, base) {
  const N = buf.readUInt32LE(base + 48);
  return { N, tailOff: base + 52 + 4*N + 4 };  // +4 to skip 0x1e sentinel
}

// Confirm sentinel
function sentinelCheck(label, buf, base) {
  const N = buf.readUInt32LE(base + 48);
  const sent = buf.readUInt32LE(base + 52 + 4*N);
  console.log(`[${label}] base=0x${base.toString(16)} N=${N} sentinel@+${52+4*N}=0x${sent.toString(16)}`);
}

for (let i = 0; i < Math.min(3, m1.length); i++) sentinelCheck(`s1.R${i}`, b1, m1[i]);
for (let i = 0; i < Math.min(3, m2.length); i++) sentinelCheck(`s2.R${i}`, b2, m2[i]);
for (let i = 0; i < Math.min(3, m3.length); i++) sentinelCheck(`s3.R${i}`, b3, m3[i]);

console.log("\n=== R0 tail dump (200 bytes after sentinel) ===");
function dumpTail(label, buf, base) {
  const { N, tailOff } = tailStart(buf, base);
  console.log(`\n[${label}] base=0x${base.toString(16)} N=${N} tailStart=0x${tailOff.toString(16)}`);
  for (let off = 0; off <= 200; off += 4) {
    const u = buf.readUInt32LE(tailOff + off);
    const i = buf.readInt32LE(tailOff + off);
    const b0 = buf[tailOff + off];
    const b1 = buf[tailOff + off + 1];
    const b2 = buf[tailOff + off + 2];
    const b3 = buf[tailOff + off + 3];
    console.log(`  +${off.toString().padStart(3)}: ${b0.toString(16).padStart(2,'0')} ${b1.toString(16).padStart(2,'0')} ${b2.toString(16).padStart(2,'0')} ${b3.toString(16).padStart(2,'0')}  u32=${u.toString().padStart(10)} (0x${u.toString(16).padStart(8,'0')})`);
  }
}
dumpTail("s1.R0", b1, m1[0]);
dumpTail("s2.R0", b2, m2[0]);
dumpTail("s3.R0", b3, m3[0]);

// Diff: find offsets in the tail (post-sentinel) that differ between saves.
console.log("\n=== Diff tail (s1 vs s2, s1 vs s3, s2 vs s3) ===");
function diffTail(la, ba, mA, lb, bb, mB, len = 1024) {
  const aN = ba.readUInt32LE(mA + 48);
  const bN = bb.readUInt32LE(mB + 48);
  const aT = mA + 52 + 4*aN + 4;
  const bT = mB + 52 + 4*bN + 4;
  console.log(`\n${la}.tail=0x${aT.toString(16)} (N=${aN}) vs ${lb}.tail=0x${bT.toString(16)} (N=${bN})`);
  let firstDiff = -1, lastDiff = -1, diffs = 0;
  for (let off = 0; off < len; off++) {
    if (ba[aT + off] !== bb[bT + off]) {
      if (firstDiff < 0) firstDiff = off;
      lastDiff = off;
      diffs++;
      if (diffs <= 40) {
        console.log(`  +${off.toString().padStart(4)}: ${ba[aT+off].toString(16).padStart(2,'0')} vs ${bb[bT+off].toString(16).padStart(2,'0')}`);
      }
    }
  }
  console.log(`  total diffs in first ${len}B: ${diffs}, range [+${firstDiff}..+${lastDiff}]`);
}
diffTail("s1.R0", b1, m1[0], "s2.R0", b2, m2[0]);
diffTail("s1.R0", b1, m1[0], "s3.R0", b3, m3[0]);
diffTail("s2.R0", b2, m2[0], "s3.R0", b3, m3[0]);

// Also: how many bytes between sentinel and next major record? Distance to m1[1].
console.log("\n=== Distance to next major (record size) ===");
for (const [label, buf, mm] of [["s1", b1, m1], ["s2", b2, m2], ["s3", b3, m3]]) {
  for (let i = 0; i < mm.length - 1; i++) {
    const N = buf.readUInt32LE(mm[i] + 48);
    const tailOff = mm[i] + 52 + 4*N + 4;
    const dist = mm[i+1] - tailOff;
    console.log(`  ${label}.R${i}: rec@0x${mm[i].toString(16)} tail@0x${tailOff.toString(16)} -> next R${i+1}@0x${mm[i+1].toString(16)} = ${dist}B (${(dist/1024).toFixed(1)}KB)`);
  }
}
