// splice-conservative.js — D10: same as D9 but ONLY patches verified
// pointers (no trailer brute-force, no possibly-false-positive top-level).
//
// D9's trailer patcher used "u32@p == p" brute force in the last 4 KB —
// 619 hits, but format_notes says trailer has 50-120 entries. So we
// probably patched 500+ bytes that weren't actually self-pointers,
// corrupting random integer fields.
//
// D10 limits patches to:
//   1. Dead-record +(pathLen+9) self-pointers (21,711 — 100% invariant)
//   2. Canonical top-level sections sec[2..7] only (6 — known structural)
//   3. Faction-record self-pointers at +4 AND +8 (478 — verified invariant)
// No trailer patches. No "extra" top-level candidates.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D10_splice_conservative.sav";
const DEAD = Buffer.from("/portraits/dead/", "ascii");
const FMAG = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);

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

// Canonical top-level sections: walk forward by sibling-jump, take ONLY
// the first 8 (sec[0..7] per format_notes layout).
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

// Faction records: find ff 0a af f0 markers + validate self-pointer invariant
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

console.log(`splice victim #50: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (-${SPLICE_BYTES} B)`);
console.log(`canonical top-level sections: ${CANONICAL_TLS.length}  (will patch those AFTER splice)`);
console.log(`verified faction records: ${factions.length}  (will patch +4 AND +8 of those AFTER splice)`);
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
console.log(`(1) dead-record self-pointers patched: ${dp}`);

// (2) Top-level section self_offsets (only canonical ones AFTER splice)
let tp = 0;
for (const s of CANONICAL_TLS) {
  if (s.off > SPLICE_FROM) {
    if (patchStalePtr(s.off, s.off)) tp++;
  }
}
console.log(`(2) canonical top-level sec self_offsets patched: ${tp}`);

// (3) Faction record self-pointers at +4 and +8
let fp = 0;
for (const f of factions) {
  if (f > SPLICE_FROM) {
    if (patchStalePtr(f + 4, f + 4)) fp++;
    if (patchStalePtr(f + 8, f + 8)) fp++;
  }
}
console.log(`(3) faction self-pointers patched: ${fp}`);

console.log();
console.log(`TOTAL: ${patchCount} patches (NO trailer brute-force)`);

fs.writeFileSync(OUT, out);
console.log(`wrote ${OUT}`);
