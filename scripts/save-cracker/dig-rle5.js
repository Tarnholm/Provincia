// dig-rle5.js — The 23 records that have PAYLOAD diffs across the
// build-queue pair (save_1 -> save_2) have all-zero CELL diffs in their
// 1020x700 mask. The decoder reports `bytesRead=9496/12326` for rec 0,
// so there are ~2830 trailing bytes AFTER the RLE stream. The byte
// diffs must be in that tail.
//
// For each of the 23 records: find the boundary where RLE stream "ends"
// (cursor reaches 714000), then count byte diffs INSIDE the mask vs the
// tail.

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

// Where does the RLE stream end? Walk it and find the point where cursor
// reaches 714000.
function findRleEnd(buf, payloadStart, payloadEnd, W = 1020, H = 700) {
  let cursor = 0;
  let p = payloadStart;
  while (p < payloadEnd - 1 && cursor < W * H) {
    const c = buf[p + 1];
    cursor += c;
    p += 2;
  }
  return p; // byte offset where RLE has consumed all 714000 cells
}

function compare(nameA, nameB, label) {
  console.log(`\n=== ${label} ===`);
  const A = loadAllRecs(nameA);
  const B = loadAllRecs(nameB);
  const N = Math.min(A.recs.length, B.recs.length) - 1;

  for (let i = 0; i < N; i++) {
    const a = A.recs[i], b = B.recs[i];
    if (a.end - a.start !== b.end - b.start) continue;
    const lenA = a.end - a.start;
    const headLen = a.payloadStart - a.start;
    const rleEndA = findRleEnd(A.buf, a.payloadStart, a.end);
    const rleEndB = findRleEnd(B.buf, b.payloadStart, b.end);
    const rleLenA = rleEndA - a.payloadStart;
    const rleLenB = rleEndB - b.payloadStart;

    let maskDiff = 0, tailDiff = 0;
    for (let k = headLen; k < lenA; k++) {
      const inMask = (a.start + k) < rleEndA;
      if (A.buf[a.start + k] !== B.buf[b.start + k]) {
        if (inMask) maskDiff++;
        else tailDiff++;
      }
    }
    if (maskDiff > 0 || tailDiff > 0) {
      console.log(`  rec ${i.toString().padStart(3)}: maskDiff=${maskDiff} tailDiff=${tailDiff} | rleLenA=${rleLenA} rleLenB=${rleLenB} totalLen=${lenA} tailLen=${lenA - (rleEndA - a.start)}`);
    }
  }
}

compare("save_1.2.sav", "save_2.2.sav", "BUILD_QUEUE (Roma stone_wall)");
compare("save_5.2.sav", "save_6.2.sav", "SHIP MOVED (5.2 -> 6.2)");
compare("save_1.2.sav", "save_3.2.sav", "LEVIES queued (1.2 -> 3.2)");
compare("save_1.2.sav", "save_4.2.sav", "QUEUE CLEARED (1.2 -> 4.2)");

// Also: what's the tail's structure? Look at rec 0's tail in save_1.
console.log(`\n=== Tail structure investigation ===`);
const A = loadAllRecs("save_1.2.sav");
const a0 = A.recs[0];
const rleEnd = findRleEnd(A.buf, a0.payloadStart, a0.end);
const tailLen = a0.end - rleEnd;
console.log(`rec 0: payloadStart=0x${a0.payloadStart.toString(16)} rleEnd=0x${rleEnd.toString(16)} recEnd=0x${a0.end.toString(16)} tailLen=${tailLen}`);
console.log(`Tail bytes (first 64):`);
console.log(`  hex:   ${[...A.buf.subarray(rleEnd, rleEnd + 64)].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
console.log(`  ascii: ${[...A.buf.subarray(rleEnd, rleEnd + 64)].map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".").join("")}`);

// What about other records' tails?
for (const idx of [1, 4, 5, 6, 7, 23, 30, 100, 200]) {
  const r = A.recs[idx];
  if (!r.end) continue;
  const e = findRleEnd(A.buf, r.payloadStart, r.end);
  const tl = r.end - e;
  console.log(`rec ${idx.toString().padStart(3)}: rleLen=${e - r.payloadStart} tailLen=${tl} recLen=${r.end - r.start}`);
  if (tl > 0) {
    console.log(`  first 48 tail bytes hex:   ${[...A.buf.subarray(e, e + Math.min(48, tl))].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(`  first 48 tail bytes ascii: ${[...A.buf.subarray(e, e + Math.min(48, tl))].map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".").join("")}`);
  }
}
