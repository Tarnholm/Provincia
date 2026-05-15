// dig-prng40-s90-1.js — Session 90: classify the per-faction tail 40-byte block
// at tail+132..+171 flagged STRONG-hypothesis in session 46.
//
// Method:
// 1. Extract the 40B block for Romans Julii (tail+36==10000 fingerprint) across
//    save_1.2, save_2.2, save_3.2.
// 2. Diff per-byte across saves.
// 3. Compute Shannon entropy (full-range histograms).
// 4. Test for ZoneA-style structure (sorted u64? two u32 fields? RNG-cache?).
// 5. For broader picture, also pull ALL major factions' 40B blocks from s1 and
//    diff them to see if blocks are faction-identity-encoded or per-save state.

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
function tailOf(buf, p) {
  const N = buf.readUInt32LE(p + 48);
  return p + 52 + 4 * N + 4;
}
function findRJ(buf) {
  for (const p of findMajors(buf)) {
    const t = tailOf(buf, p);
    if (buf.readUInt32LE(t + 36) === 10000) return { base: p, tail: t };
  }
  return null;
}
function entropy(arr) {
  const total = arr.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let H = 0;
  for (const v of arr) {
    if (v > 0) {
      const p = v / total;
      H -= p * Math.log2(p);
    }
  }
  return H;
}
function byteHist(buf, off, len) {
  const h = new Array(256).fill(0);
  for (let i = 0; i < len; i++) h[buf[off + i]]++;
  return h;
}

const rj1 = findRJ(b1), rj2 = findRJ(b2), rj3 = findRJ(b3);
console.log(`RJ tails: s1=0x${rj1.tail.toString(16)} s2=0x${rj2.tail.toString(16)} s3=0x${rj3.tail.toString(16)}`);

// Pull the 40-byte block
const BLK_OFF = 132, BLK_LEN = 40;
const blk1 = b1.slice(rj1.tail + BLK_OFF, rj1.tail + BLK_OFF + BLK_LEN);
const blk2 = b2.slice(rj2.tail + BLK_OFF, rj2.tail + BLK_OFF + BLK_LEN);
const blk3 = b3.slice(rj3.tail + BLK_OFF, rj3.tail + BLK_OFF + BLK_LEN);

console.log(`\n--- Romans Julii 40B block (tail+132..+171) ---`);
console.log(`s1: ${blk1.toString("hex")}`);
console.log(`s2: ${blk2.toString("hex")}`);
console.log(`s3: ${blk3.toString("hex")}`);

// Per-byte diff
let nDiff12 = 0, nDiff13 = 0, nDiff23 = 0, nAllSame = 0, nAllDiff = 0;
const diffMask = [];
for (let i = 0; i < BLK_LEN; i++) {
  const v1 = blk1[i], v2 = blk2[i], v3 = blk3[i];
  if (v1 === v2 && v1 === v3) { nAllSame++; diffMask.push("."); continue; }
  if (v1 !== v2) nDiff12++;
  if (v1 !== v3) nDiff13++;
  if (v2 !== v3) nDiff23++;
  if (v1 !== v2 && v1 !== v3 && v2 !== v3) { nAllDiff++; diffMask.push("X"); }
  else diffMask.push("x");
}
console.log(`\nDiff summary (40 bytes): allSame=${nAllSame} s1≠s2=${nDiff12} s1≠s3=${nDiff13} s2≠s3=${nDiff23} all3differ=${nAllDiff}`);
console.log(`Mask:  ${diffMask.join("")}`);

// Entropy of the 40 bytes
const e1 = entropy(byteHist(b1, rj1.tail + BLK_OFF, BLK_LEN));
const e2 = entropy(byteHist(b2, rj2.tail + BLK_OFF, BLK_LEN));
const e3 = entropy(byteHist(b3, rj3.tail + BLK_OFF, BLK_LEN));
console.log(`Entropy (Shannon, 40 samples): s1=${e1.toFixed(3)} s2=${e2.toFixed(3)} s3=${e3.toFixed(3)} (40 unique max ≈ ${Math.log2(40).toFixed(3)})`);

// Interpret as u32 LE values
console.log(`\n--- As u32 LE (10 fields) ---`);
console.log(`#   s1                  s2                  s3                  same?`);
for (let i = 0; i < 10; i++) {
  const off = BLK_OFF + i * 4;
  const v1 = b1.readUInt32LE(rj1.tail + off);
  const v2 = b2.readUInt32LE(rj2.tail + off);
  const v3 = b3.readUInt32LE(rj3.tail + off);
  const same = (v1 === v2 && v1 === v3) ? "ALL=" : (v1 === v2 ? "s1=s2" : v1 === v3 ? "s1=s3" : v2 === v3 ? "s2=s3" : "DIFF");
  console.log(`+${off.toString().padStart(3)}: 0x${v1.toString(16).padStart(8,'0')} (${v1.toString().padStart(11)})  0x${v2.toString(16).padStart(8,'0')} (${v2.toString().padStart(11)})  0x${v3.toString(16).padStart(8,'0')} (${v3.toString().padStart(11)})  ${same}`);
}

// Also dump as 5 × u64 LE
console.log(`\n--- As u64 LE (5 fields) ---`);
function readU64LE(buf, off) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(buf[off + i]);
  return v;
}
for (let i = 0; i < 5; i++) {
  const off = BLK_OFF + i * 8;
  const v1 = readU64LE(b1, rj1.tail + off);
  const v2 = readU64LE(b2, rj2.tail + off);
  const v3 = readU64LE(b3, rj3.tail + off);
  console.log(`+${off.toString().padStart(3)}: s1=${v1.toString(16).padStart(16,'0')} | s2=${v2.toString(16).padStart(16,'0')} | s3=${v3.toString(16).padStart(16,'0')}`);
}

// ZoneA overlap test: is block sorted? Are top halves zero (u32-only)?
let s1sorted = true, last = 0n;
for (let i = 0; i < 5; i++) {
  const v = readU64LE(b1, rj1.tail + BLK_OFF + i * 8);
  if (v < last) { s1sorted = false; break; }
  last = v;
}
let s1u32only = 0;
for (let i = 0; i < 5; i++) {
  const v = readU64LE(b1, rj1.tail + BLK_OFF + i * 8);
  if (v < 0x100000000n) s1u32only++;
}
console.log(`\nZoneA-style probes: s1 5×u64 sorted=${s1sorted}, top-half-zero count=${s1u32only}/5`);

// ============================================================================
// Broader probe: pull 40B block from EVERY major faction in s1.
// If block is identity-tied to faction (slow-changing), all factions differ.
// If block is per-save PRNG state, factions might still differ but share a pattern.
// ============================================================================
console.log(`\n=== All ${findMajors(b1).length} major factions in s1: 40B block + treasury (+0, tail+36) ===`);
const allM1 = findMajors(b1);
const blocks = [];
for (const p of allM1) {
  const t = tailOf(b1, p);
  const blk = b1.slice(t + BLK_OFF, t + BLK_OFF + BLK_LEN);
  blocks.push({ base: p, tail: t, net: b1.readInt32LE(p), disp: b1.readUInt32LE(t + 36), hex: blk.toString("hex") });
}
for (const r of blocks) {
  console.log(`  base=0x${r.base.toString(16)} net=${r.net.toString().padStart(7)} disp=${r.disp.toString().padStart(7)} blk[0:16]=${r.hex.slice(0, 32)} blk[16:32]=${r.hex.slice(32, 64)} blk[32:40]=${r.hex.slice(64, 80)}`);
}

// Are any blocks identical across factions in same save?
const seen = new Map();
for (const r of blocks) {
  const k = r.hex;
  seen.set(k, (seen.get(k) || 0) + 1);
}
const dupes = [...seen.entries()].filter(([k, v]) => v > 1);
console.log(`\nUnique 40B blocks across ${blocks.length} factions in s1: ${seen.size} (duplicates: ${dupes.length})`);
if (dupes.length > 0) {
  for (const [k, v] of dupes) console.log(`  ${v}× ${k}`);
}

// Per-byte-position entropy across factions in s1 — if it's high for every position,
// the block is faction-discriminating (PRNG/hash like a faction-seed).
console.log(`\nPer-byte-position entropy across ${blocks.length} factions in s1:`);
let totalH = 0;
for (let i = 0; i < BLK_LEN; i++) {
  const h = new Array(256).fill(0);
  for (const r of blocks) h[Buffer.from(r.hex.slice(i*2, i*2+2), "hex")[0]]++;
  const H = entropy(h);
  totalH += H;
  process.stdout.write(`[${i.toString().padStart(2)}]=${H.toFixed(2)} `);
  if ((i + 1) % 10 === 0) process.stdout.write("\n");
}
console.log(`\nMean per-byte H = ${(totalH / BLK_LEN).toFixed(3)} (max for ${blocks.length} samples ≈ ${Math.log2(blocks.length).toFixed(3)})`);
