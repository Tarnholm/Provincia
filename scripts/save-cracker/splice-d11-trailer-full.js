// splice-d11-trailer-full.js — D11: D10 + ALL trailer self-pointers.
//
// Trailer region (after sec[7] end) contains 34,739 self-pointers per
// brute-force scan. Many are real (faction-like records, sub-section
// headers). Even D9's 619-count was probably an under-count because it
// only scanned the last 4 KB. The trailer is 2.4 MB!
//
// D11 patches EVERY self-pointer in the trailer that points to a
// position > splice_from (= every position in the trailer, since trailer
// starts at 0x40f772c >> SPLICE_FROM).

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D11_splice_d10_plus_trailer.sav";
const DEAD = Buffer.from("/portraits/dead/", "ascii");
const FMAG = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
const TRAILER_START = 0x40f772c;

function locateRecords(buf) {
  const records = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(DEAD, from);
    if (i < 0) break;
    let dataOff = -1;
    for (let p = i - 1; p >= i - 64; p--) {
      if (buf[p] === 0x64 && buf[p+1] === 0x61 && buf[p+2] === 0x74 && buf[p+3] === 0x61 && buf[p+4] === 0x2f) {
        dataOff = p; break;
      }
    }
    if (dataOff < 0) { from = i + DEAD.length; continue; }
    const lp = dataOff - 2;
    const pl = buf.readUInt16LE(lp);
    if (pl < 16 || pl > 200) { from = i + DEAD.length; continue; }
    records.push({ lenPrefixOff: lp, pathLen: pl, selfPtrOff: lp + pl + 9 });
    from = dataOff + pl;
  }
  for (let k = 0; k < records.length - 1; k++) records[k].endOff = records[k + 1].lenPrefixOff;
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);

// Top-level sections (canonical, first 8)
const CANONICAL_TLS = [];
{
  let p = 0x3b99;
  while (CANONICAL_TLS.length < 8 && p + 8 <= buf.length) {
    if (buf.readUInt32LE(p) === p) {
      const sz = buf.readUInt32LE(p + 4);
      if (sz >= 8 && p + sz <= buf.length) {
        CANONICAL_TLS.push({ off: p, size: sz });
        p += sz;
        continue;
      }
    }
    p++;
  }
}

// Faction records by magic, validated by self-pointer pair
const factions = [];
{
  let from = 0;
  while (true) {
    const i = buf.indexOf(FMAG, from);
    if (i < 0) break;
    if (i + 12 <= buf.length &&
        buf.readUInt32LE(i + 4) === i + 4 &&
        buf.readUInt32LE(i + 8) === i + 8) {
      factions.push(i);
    }
    from = i + 4;
  }
}

const victim = recs[50];
const SPLICE_FROM = victim.lenPrefixOff;
const SPLICE_TO   = victim.endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;

console.log(`splice: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (-${SPLICE_BYTES} B)`);
console.log();

const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

let patchCount = 0;
function patchStalePtr(originalOff, originalVal) {
  const newPos = originalOff < SPLICE_FROM ? originalOff : originalOff - SPLICE_BYTES;
  if (newPos + 4 > out.length) return false;
  const cur = out.readUInt32LE(newPos);
  if (cur !== originalVal) return false;
  out.writeUInt32LE(originalVal - SPLICE_BYTES, newPos);
  patchCount++;
  return true;
}

// (1) Dead-record self-pointers
let dp = 0;
for (let i = 51; i < recs.length; i++) {
  if (patchStalePtr(recs[i].selfPtrOff, recs[i].selfPtrOff)) dp++;
}
console.log(`(1) dead-record self-pointers: ${dp}`);

// (2) Canonical top-level sections
let tp = 0;
for (const s of CANONICAL_TLS) {
  if (s.off > SPLICE_FROM && patchStalePtr(s.off, s.off)) tp++;
}
console.log(`(2) canonical top-level sec self_offsets: ${tp}`);

// (3) Faction records (in sec[7], at ~0x3d12d92 onwards)
let fp = 0;
for (const f of factions) {
  if (f > SPLICE_FROM) {
    if (patchStalePtr(f + 4, f + 4)) fp++;
    if (patchStalePtr(f + 8, f + 8)) fp++;
  }
}
console.log(`(3) faction self-pointers: ${fp}`);

// (4) ALL trailer self-pointers (brute-force, only in trailer region)
// Trailer starts at 0x40f772c. Every self-pointer there has position > splice.
let trp = 0;
for (let p = TRAILER_START; p + 4 <= buf.length; p++) {
  if (buf.readUInt32LE(p) === p) {
    if (patchStalePtr(p, p)) trp++;
  }
}
console.log(`(4) trailer self-pointers (brute-force, full trailer): ${trp}`);

console.log();
console.log(`TOTAL patches: ${patchCount}`);

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length} (-${buf.length - out.length})`);
