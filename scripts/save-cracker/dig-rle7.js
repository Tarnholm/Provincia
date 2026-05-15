// dig-rle7.js — Inspect rec 0's tail in save_1.2 vs save_2.2.
// Hypothesis: tail = per-faction discovered-settlement list. When Roma
// queues a building, every faction that knows Roma updates its
// "discovered-buildings-at-Roma" list.

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);

function findAllMagic(buf, hint = 0) {
  const o = [];
  let p = hint;
  while (true) {
    const i = buf.indexOf(MAGIC, p);
    if (i < 0) break;
    o.push(i);
    p = i + 4;
  }
  return o;
}

function loadAllRecs(name) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, name));
  const offs = findAllMagic(buf, 0x1f00000);
  const recs = [];
  for (let i = 0; i < offs.length; i++) {
    const start = offs[i] - 8;
    const next = i + 1 < offs.length ? offs[i + 1] - 8 : null;
    recs.push({ start, magicOff: offs[i], end: next, payloadStart: offs[i] + 12 });
  }
  return { buf, recs };
}

function findRleEnd(buf, payloadStart, payloadEnd, W = 1020, H = 700) {
  let cursor = 0;
  let p = payloadStart;
  while (p < payloadEnd - 1 && cursor < W * H) {
    const c = buf[p + 1];
    cursor += c;
    p += 2;
  }
  return p;
}

// Find ASCII strings: u32-prefixed (not u16) — we saw "0d 00 00 00 45 61 73 74 65 72 6e 5f 54 6f 77 6e 00 = 13 bytes "Eastern_Town\0"
function findStringsU32(buf, start, end) {
  const out = [];
  let p = start;
  while (p < end - 4) {
    const len = buf.readUInt32LE(p);
    if (len > 4 && len < 64 && p + 4 + len <= end) {
      const slice = buf.subarray(p + 4, p + 4 + len);
      let ok = true;
      for (const c of slice) { if (c < 0x20 || c > 0x7e) { ok = false; break; } }
      if (ok) {
        out.push({ off: p, str: slice.toString("ascii") });
        p += 4 + len;
        continue;
      }
    }
    p++;
  }
  return out;
}

const A = loadAllRecs("save_1.2.sav");
const B = loadAllRecs("save_2.2.sav");

console.log(`=== rec 0 tail A (save_1.2) ===`);
{
  const r = A.recs[0];
  const rleEnd = findRleEnd(A.buf, r.payloadStart, r.end);
  const strs = findStringsU32(A.buf, rleEnd, r.end);
  console.log(`tail range: [0x${rleEnd.toString(16)} .. 0x${r.end.toString(16)}) len=${r.end - rleEnd}`);
  console.log(`Strings found: ${strs.length}`);
  for (const s of strs) console.log(`  +${(s.off - rleEnd).toString().padStart(4)}: "${s.str}"`);
}
console.log(`\n=== rec 0 tail B (save_2.2) ===`);
{
  const r = B.recs[0];
  const rleEnd = findRleEnd(B.buf, r.payloadStart, r.end);
  const strs = findStringsU32(B.buf, rleEnd, r.end);
  console.log(`tail range: [0x${rleEnd.toString(16)} .. 0x${r.end.toString(16)}) len=${r.end - rleEnd}`);
  console.log(`Strings found: ${strs.length}`);
  for (const s of strs) console.log(`  +${(s.off - rleEnd).toString().padStart(4)}: "${s.str}"`);
}

// Dump byte-level diffs in rec 0 tail (location and context)
console.log(`\n=== rec 0 byte diffs (save_1 -> save_2) inside tail ===`);
{
  const ra = A.recs[0], rb = B.recs[0];
  const rleEndA = findRleEnd(A.buf, ra.payloadStart, ra.end);
  const rleEndB = findRleEnd(B.buf, rb.payloadStart, rb.end);
  console.log(`tail starts: A=0x${rleEndA.toString(16)} B=0x${rleEndB.toString(16)}`);
  const tailLenA = ra.end - rleEndA;
  const tailLenB = rb.end - rleEndB;
  console.log(`tailLen: A=${tailLenA} B=${tailLenB}`);
  if (tailLenA !== tailLenB) console.log(`!! tail lengths differ`);
  const len = Math.min(tailLenA, tailLenB);
  const diffOffsets = [];
  for (let k = 0; k < len; k++) {
    if (A.buf[rleEndA + k] !== B.buf[rleEndB + k]) diffOffsets.push(k);
  }
  console.log(`Diff offsets within tail (count=${diffOffsets.length}): ${diffOffsets.join(", ")}`);
  // Show context around first few diff offsets
  console.log(`\nContext around each diff (16 bytes before/after, hex+ascii):`);
  const shown = new Set();
  for (const off of diffOffsets.slice(0, 8)) {
    const window = Math.max(0, off - 8);
    const slice = 24;
    const aHex = [...A.buf.subarray(rleEndA + window, rleEndA + window + slice)].map(b => b.toString(16).padStart(2, "0")).join(" ");
    const bHex = [...B.buf.subarray(rleEndB + window, rleEndB + window + slice)].map(b => b.toString(16).padStart(2, "0")).join(" ");
    const aAs = [...A.buf.subarray(rleEndA + window, rleEndA + window + slice)].map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".").join("");
    const bAs = [...B.buf.subarray(rleEndB + window, rleEndB + window + slice)].map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".").join("");
    console.log(`  tail+${off}:`);
    console.log(`    A: ${aHex}  | ${aAs}`);
    console.log(`    B: ${bHex}  | ${bAs}`);
  }
}

// Same for rec 6 (Carthage according to session 17 — "Carthaginian" strings show up)
console.log(`\n=== rec 6 tail strings (save_1.2) ===`);
{
  const r = A.recs[6];
  const rleEnd = findRleEnd(A.buf, r.payloadStart, r.end);
  const strs = findStringsU32(A.buf, rleEnd, r.end);
  console.log(`Strings found: ${strs.length}`);
  for (const s of strs.slice(0, 30)) console.log(`  +${(s.off - rleEnd).toString().padStart(4)}: "${s.str}"`);
}
