// dig-religion-find-vector.js
// Hypothesis: religion spread is a DENSE array of N=53 entries (one per belief in
// descr_beliefs order). Try several encodings and scan the whole save for runs that
// look like a probability/percentage vector over 53 beliefs:
//   (A) 53 × u8   percentages, sum 90..110, at least 1 dominant
//   (B) 53 × u16  (sum 90..110 or sum ~1000/10000)
//   (C) 53 × u32
//   (D) 53 × f32  summing to ~1.0
// Report how many hits each encoding produces and a few samples.
//
// We expect ~ (#settlements) hits for the correct encoding. There are ~70-100
// settlements on the imperial map within the player+visible world; the save likely
// stores ALL 1300 region religion vectors though (one per region). So a correct
// encoding should yield somewhere from dozens to ~1300 hits clustered together.

const fs = require("fs");
const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);
const N = 53;
const len = buf.length;

function scanU8(domMin) {
  const hits = [];
  for (let o = 0; o + N <= len; o++) {
    let sum = 0, max = 0, nz = 0, ok = true;
    for (let i = 0; i < N; i++) {
      const b = buf[o + i];
      if (b > 100) { ok = false; break; }
      sum += b; if (b > max) max = b; if (b > 0) nz++;
    }
    if (!ok) continue;
    if (sum < 90 || sum > 110) continue;
    if (max < domMin) continue;       // require a dominant religion
    if (nz < 1 || nz > 8) continue;   // a region rarely has >8 active beliefs
    hits.push({ o, sum, max, nz });
    o += N - 1;
  }
  return hits;
}

function scanU16(scale, lo, hi) {
  // values stored as u16; sum target between lo..hi
  const hits = [];
  for (let o = 0; o + N * 2 <= len; o += 2) {
    let sum = 0, max = 0, nz = 0, ok = true;
    for (let i = 0; i < N; i++) {
      const v = buf.readUInt16LE(o + i * 2);
      if (v > scale) { ok = false; break; }
      sum += v; if (v > max) max = v; if (v > 0) nz++;
    }
    if (!ok) continue;
    if (sum < lo || sum > hi) continue;
    if (nz < 1 || nz > 10) continue;
    hits.push({ o, sum, max, nz });
    o += (N - 1) * 2;
  }
  return hits;
}

function scanF32() {
  const hits = [];
  for (let o = 0; o + N * 4 <= len; o += 4) {
    let sum = 0, max = 0, nz = 0, ok = true;
    for (let i = 0; i < N; i++) {
      const v = buf.readFloatLE(o + i * 4);
      if (!(v >= 0 && v <= 1.0001)) { ok = false; break; }
      sum += v; if (v > max) max = v; if (v > 0.001) nz++;
    }
    if (!ok) continue;
    if (sum < 0.9 || sum > 1.1) continue;
    if (nz < 1 || nz > 12) continue;
    hits.push({ o, sum: +sum.toFixed(3), max: +max.toFixed(3), nz });
    o += (N - 1) * 4;
  }
  return hits;
}

console.log("=== (A) 53 × u8, sum 90..110, dominant >= 40 ===");
let a = scanU8(40);
console.log("hits:", a.length);
a.slice(0, 10).forEach(h => console.log("  0x" + h.o.toString(16) + " sum=" + h.sum + " max=" + h.max + " nz=" + h.nz + " [" + Array.from(buf.slice(h.o, h.o+N)).join(",") + "]"));

console.log("\n=== (A') 53 × u8, sum 90..110, dominant >= 20 ===");
let a2 = scanU8(20);
console.log("hits:", a2.length);

console.log("\n=== (B) 53 × u16 scale 100, sum 90..110 ===");
let b = scanU16(100, 90, 110);
console.log("hits:", b.length);
b.slice(0, 6).forEach(h => console.log("  0x" + h.o.toString(16) + " sum=" + h.sum + " max=" + h.max + " nz=" + h.nz));

console.log("\n=== (B') 53 × u16 scale 1000, sum 900..1100 ===");
let b2 = scanU16(1000, 900, 1100);
console.log("hits:", b2.length);

console.log("\n=== (B'') 53 × u16 scale 10000, sum 9000..11000 ===");
let b3 = scanU16(10000, 9000, 11000);
console.log("hits:", b3.length);

console.log("\n=== (D) 53 × f32 summing ~1.0 ===");
let d = scanF32();
console.log("hits:", d.length);
d.slice(0, 6).forEach(h => console.log("  0x" + h.o.toString(16) + " sum=" + h.sum + " max=" + h.max + " nz=" + h.nz));
