// dig-factail-session46-3.js — Session 46 attempt 3: pinpoint the SAME faction
// (Romans Julii) across all 3 saves using a stable identifier other than cookie
// (cookies are not stable). Then diff the tail bytes.
//
// New observation from attempt 2:
//   - s3.R0 has treasury=9022 (10000 - 978) AND tail+36 still says 10000.
//     This means **tail+36 = original/displayed treasury**, base+0 = net.
//   - 978 looks like a building cost! Or maybe a recruitment cost. The user
//     said s3 has "levies queued" in Roma.
//
// Hypothesis: tail+36 is the "PUBLIC" treasury (before queue payments), and
// base+0 is the actual treasury after costs are deducted.
//
// But wait: in s2 (stone_wall queued), treasury is STILL 10000. So why is s3
// down to 9022? Maybe stone_wall hadn't been paid yet in s2 (queued but not
// charged); levies in s3 also queued but mercenaries are paid immediately?

const fs = require("fs");
const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const S1 = `${ROME_DIR}/save_1.2.sav`;
const S2 = `${ROME_DIR}/save_2.2.sav`;
const S3 = `${ROME_DIR}/save_3.2.sav`;

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

// Best identifier for Romans Julii: tail+36 = 10000 starting treasury
function findRJ(buf, m) {
  for (const p of m) {
    const N = buf.readUInt32LE(p + 48);
    const tail = p + 52 + 4*N + 4;
    if (buf.readUInt32LE(tail + 36) === 10000) return { base: p, tail, N };
  }
  return null;
}
const rj1 = findRJ(b1, m1);
const rj2 = findRJ(b2, m2);
const rj3 = findRJ(b3, m3);
console.log(`RJ (tail+36=10000):`);
console.log(`  s1: base=0x${rj1.base.toString(16)} N=${rj1.N} tail=0x${rj1.tail.toString(16)} treasury=${b1.readInt32LE(rj1.base)}`);
console.log(`  s2: base=0x${rj2.base.toString(16)} N=${rj2.N} tail=0x${rj2.tail.toString(16)} treasury=${b2.readInt32LE(rj2.base)}`);
console.log(`  s3: base=0x${rj3.base.toString(16)} N=${rj3.N} tail=0x${rj3.tail.toString(16)} treasury=${b3.readInt32LE(rj3.base)}`);

// Show the full tail dump as u32 LE values for all 3 saves side by side.
console.log("\n=== Tail bytes 0..400 as u32 LE side-by-side (s1 / s2 / s3) ===");
console.log("Off   s1                  s2                  s3                  same?");
for (let off = 0; off <= 400; off += 4) {
  const v1 = b1.readUInt32LE(rj1.tail + off);
  const v2 = b2.readUInt32LE(rj2.tail + off);
  const v3 = b3.readUInt32LE(rj3.tail + off);
  const same = (v1 === v2 && v1 === v3) ? "✓" : (v1 === v2 ? "s1=s2" : v1 === v3 ? "s1=s3" : v2 === v3 ? "s2=s3" : "DIFF");
  console.log(`+${off.toString().padStart(3)}: ${v1.toString().padStart(11)} (0x${v1.toString(16).padStart(8,'0')})  ${v2.toString().padStart(11)} (0x${v2.toString(16).padStart(8,'0')})  ${v3.toString().padStart(11)} (0x${v3.toString(16).padStart(8,'0')})  ${same}`);
}

// Special focus: bytes that differ s1 vs s2 = should reflect "stone_wall queued".
// Bytes that differ s1 vs s3 = should reflect "levies queued".
// Bytes same in s1,s2 but diff in s3 = levies-specific.
// Bytes same in s1,s3 but diff in s2 = stone_wall-specific.

console.log("\n=== Per-byte diff analysis (1024 bytes) ===");
let counts = { s1s2: 0, s1s3: 0, s2s3: 0, allDiff: 0, allSame: 0 };
const interesting = [];
for (let off = 0; off < 1024; off++) {
  const v1 = b1[rj1.tail + off];
  const v2 = b2[rj2.tail + off];
  const v3 = b3[rj3.tail + off];
  if (v1 === v2 && v1 === v3) { counts.allSame++; continue; }
  if (v1 === v2) counts.s1s2++;
  else if (v1 === v3) counts.s1s3++;
  else if (v2 === v3) counts.s2s3++;
  else counts.allDiff++;
  if (interesting.length < 80) interesting.push({ off, v1, v2, v3 });
}
console.log(`allSame=${counts.allSame}, s1=s2 (s3 diff = levies)=${counts.s1s2}, s1=s3 (s2 diff = stone_wall)=${counts.s1s3}, s2=s3=${counts.s2s3}, all3 differ=${counts.allDiff}`);

console.log("\n=== Diff offsets (first 80) ===");
console.log("Off   s1   s2   s3   pattern");
for (const d of interesting) {
  const pattern = (d.v1 === d.v2) ? "s1=s2,s3-diff (LEVIES)" : (d.v1 === d.v3) ? "s1=s3,s2-diff (STONE)" : (d.v2 === d.v3) ? "s2=s3,s1-diff" : "all-diff";
  console.log(`  +${d.off.toString().padStart(3)}: ${d.v1.toString(16).padStart(2,'0')} ${d.v2.toString(16).padStart(2,'0')} ${d.v3.toString(16).padStart(2,'0')}  ${pattern}`);
}

// Look up base+0 vs tail+36 — the diff is queue cost.
console.log("\n=== Treasury cross-check ===");
console.log(`s1: net=${b1.readInt32LE(rj1.base)} disp(+36)=${b1.readUInt32LE(rj1.tail+36)} diff=${b1.readUInt32LE(rj1.tail+36) - b1.readInt32LE(rj1.base)}`);
console.log(`s2: net=${b2.readInt32LE(rj2.base)} disp(+36)=${b2.readUInt32LE(rj2.tail+36)} diff=${b2.readUInt32LE(rj2.tail+36) - b2.readInt32LE(rj2.base)}`);
console.log(`s3: net=${b3.readInt32LE(rj3.base)} disp(+36)=${b3.readUInt32LE(rj3.tail+36)} diff=${b3.readUInt32LE(rj3.tail+36) - b3.readInt32LE(rj3.base)}`);
