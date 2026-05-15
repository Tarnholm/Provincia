// dig-strideorder-session47-1.js
// Session 47: decode the stride-16 array at faction-tail +208..
// Goal: pin the meaning of the 3 u32 fields after the 0x00010101 header.
//
// Records: [u32=0x00010101][u32 A][u32 B][u32 C], terminated by 0x1e.
// Count: s1≥12, s2~2, s3=1 (drops when player queues an action).
//
// Plan:
// 1. Re-locate Romans Julii in each save (tail+36==10000).
// 2. Enumerate the stride-16 array until terminator or sanity-cap.
// 3. Dump A/B/C for each record across all 3 saves.
// 4. Check: do A values overlap across saves? do they look like settlement
//    IDs (typically 0x0000xxxx with xxxx<1500), small ints, or building IDs
//    (stone_wall=8000)?

const fs = require("fs");
const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVES = [
  ["s1", `${ROME_DIR}/save_1.2.sav`, "baseline"],
  ["s2", `${ROME_DIR}/save_2.2.sav`, "stone_wall queued"],
  ["s3", `${ROME_DIR}/save_3.2.sav`, "levies queued"],
];

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
function findRJ(buf) {
  for (const p of findMajors(buf)) {
    const N = buf.readUInt32LE(p + 48);
    const tail = p + 52 + 4 * N + 4;
    if (buf.readUInt32LE(tail + 36) === 10000) return { base: p, tail, N };
  }
  return null;
}

// Enumerate stride-16 records starting at tail+208.
// Terminator: 0x1e (u32) — but be lenient (some entries may start with 0x00010101 or 0x0001 variants).
function readStride(buf, start, maxRecords = 32) {
  const recs = [];
  for (let i = 0; i < maxRecords; i++) {
    const off = start + i * 16;
    if (off + 16 > buf.length) break;
    const hdr = buf.readUInt32LE(off);
    // Terminator detection: a u32==0x1e (=30) where header should be.
    if (hdr === 0x1e) break;
    // Some records may have hdr != 0x00010101 - record but flag.
    const A = buf.readUInt32LE(off + 4);
    const B = buf.readUInt32LE(off + 8);
    const C = buf.readUInt32LE(off + 12);
    recs.push({ off, hdr, A, B, C });
    // Sanity: if hdr is 0 and A,B,C all 0, stop.
    if (hdr === 0 && A === 0 && B === 0 && C === 0) { recs.pop(); break; }
  }
  return recs;
}

const results = {};
for (const [tag, path, desc] of SAVES) {
  const buf = fs.readFileSync(path);
  const rj = findRJ(buf);
  if (!rj) { console.log(`${tag}: RJ not found`); continue; }
  const strideStart = rj.tail + 208;
  const recs = readStride(buf, strideStart, 32);
  results[tag] = { rj, recs, desc };
  console.log(`\n=== ${tag} (${desc}) — RJ base=0x${rj.base.toString(16)} tail=0x${rj.tail.toString(16)} ===`);
  console.log(`stride starts at 0x${strideStart.toString(16)}, ${recs.length} records before terminator`);
  console.log("idx  off       hdr        A          B          C          (A hex)");
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    console.log(`${i.toString().padStart(2)}: 0x${r.off.toString(16).padStart(6,'0')}  0x${r.hdr.toString(16).padStart(8,'0')}  ${r.A.toString().padStart(8)}  ${r.B.toString().padStart(8)}  ${r.C.toString().padStart(8)}  (0x${r.A.toString(16)})`);
  }
}

// Cross-save analysis: does s3's single record appear in s2? Does s2's records appear in s1?
console.log("\n=== Cross-save A-value comparison ===");
const aSets = {};
for (const [tag] of SAVES) {
  if (!results[tag]) continue;
  aSets[tag] = new Set(results[tag].recs.map(r => r.A));
  console.log(`${tag} A-values: ${[...aSets[tag]].sort((a,b)=>a-b).join(", ")}`);
}
if (aSets.s1 && aSets.s3) {
  const s3only = [...aSets.s3].filter(a => !aSets.s1.has(a));
  const s3inS1 = [...aSets.s3].filter(a => aSets.s1.has(a));
  console.log(`s3 A-values that ARE in s1 (=survives queueing): [${s3inS1.join(",")}]`);
  console.log(`s3 A-values NOT in s1 (=new): [${s3only.join(",")}]`);
}
if (aSets.s1 && aSets.s2) {
  const s2inS1 = [...aSets.s2].filter(a => aSets.s1.has(a));
  console.log(`s2 A-values in s1: [${s2inS1.join(",")}]`);
}
if (aSets.s2 && aSets.s3) {
  const inter = [...aSets.s2].filter(a => aSets.s3.has(a));
  console.log(`s2 ∩ s3 A-values: [${inter.join(",")}]`);
}

// Stat: range of A values across all saves.
const allA = [];
for (const tag of Object.keys(results)) for (const r of results[tag].recs) allA.push(r.A);
allA.sort((a,b)=>a-b);
console.log(`\nA-value range across all saves: min=${allA[0]} max=${allA[allA.length-1]} count=${allA.length}`);
console.log(`A-values (sorted, all saves): ${allA.join(", ")}`);

// Stat: B and C value distributions.
const allB = [], allC = [];
for (const tag of Object.keys(results)) for (const r of results[tag].recs) { allB.push(r.B); allC.push(r.C); }
console.log(`B values (all saves): ${[...new Set(allB)].sort((a,b)=>a-b).join(", ")}`);
console.log(`C values (all saves): ${[...new Set(allC)].sort((a,b)=>a-b).join(", ")}`);

// Cross-check: stone_wall building ID is reportedly 8000 (session 11). Look for it.
console.log(`\nstone_wall=8000 in A? ${allA.includes(8000) ? "YES" : "no"}`);
console.log(`stone_wall=8000 in B? ${allB.includes(8000) ? "YES" : "no"}`);
console.log(`stone_wall=8000 in C? ${allC.includes(8000) ? "YES" : "no"}`);
