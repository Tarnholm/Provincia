// splice-comprehensive.js — D9: comprehensive self-pointer patcher.
//
// D7 patched 21,711 dead-record self-pointers (+9) but failed to load.
// Reason: many OTHER self-pointers in the file are also stale post-splice.
// Inventory of self-pointer types we now know about:
//   1. Dead-record self-pointer at +(pathLen+9)        — 21,762 instances
//   2. Top-level section self_offset at sec start      — 7-10 instances
//   3. Faction-record self-pointers at +4 and +8       — 239*2 = 478
//   4. Trailer offset-index entries (per format_notes) — ~50-120
//
// D9 patches every stale self-pointer we can identify, then writes the
// spliced+patched save. Decisive test of the self-pointer hypothesis.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D9_splice_comprehensive.sav";
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

function findTopLevelSections(buf) {
  // Walk forward from body root by sibling-jump
  const tls = [];
  let p = 0x3b99;
  while (p + 8 <= buf.length) {
    if (buf.readUInt32LE(p) === p) {
      const sz = buf.readUInt32LE(p + 4);
      if (sz >= 8 && p + sz <= buf.length) {
        tls.push({ off: p, size: sz });
        p += sz;
        continue;
      }
    }
    p++;
  }
  return tls;
}

function findFactions(buf) {
  const arr = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(FMAG, from);
    if (i < 0) break;
    // Each faction has self-pointers at +4 and +8, terminated by "f0 0a af f0" at +12
    const sp1 = buf.readUInt32LE(i + 4);
    const sp2 = buf.readUInt32LE(i + 8);
    if (sp1 === i + 4 && sp2 === i + 8) arr.push(i);
    from = i + 4;
  }
  return arr;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
const tls  = findTopLevelSections(buf);
const facs = findFactions(buf);

console.log(`dead records: ${recs.length}`);
console.log(`top-level sections: ${tls.length} (first 8 are canonical; rest likely false-positives)`);
console.log(`faction records (verified by self-ptr invariant): ${facs.length}`);
console.log();

const victim = recs[50];
const SPLICE_FROM = victim.lenPrefixOff;
const SPLICE_TO   = victim.endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;
console.log(`splice victim #50: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (-${SPLICE_BYTES} B)`);
console.log();

// Build patched buffer
const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

let patchCount = 0;
function patchPointer(originalOff, originalVal, label) {
  // The pointer field was at originalOff in the source file. If originalOff
  // was AFTER the splice, it's now at originalOff - SPLICE_BYTES in `out`.
  // If originalOff was BEFORE, it's at the same position.
  const newPos = originalOff < SPLICE_FROM ? originalOff : originalOff - SPLICE_BYTES;
  if (newPos + 4 > out.length) return false;
  const current = out.readUInt32LE(newPos);
  if (current !== originalVal) {
    // Already-correct or wrong-value; don't blindly patch
    return false;
  }
  out.writeUInt32LE(originalVal - SPLICE_BYTES, newPos);
  patchCount++;
  return true;
}

// (1) Dead-record self-pointers at +(pathLen+9), records AFTER splice only.
let deadPatched = 0;
for (let i = 51; i < recs.length; i++) {
  if (patchPointer(recs[i].selfPtrOff, recs[i].selfPtrOff, `dead#${i}+9`)) deadPatched++;
}
console.log(`(1) dead-record +9 self-pointers patched: ${deadPatched} / ${recs.length - 51}`);

// (2) Top-level section self_offsets for sections starting AFTER splice.
// Only patch the FIRST ~12 (canonical top-level) to avoid false positives.
let tlsPatched = 0;
for (let i = 0; i < Math.min(tls.length, 16); i++) {
  if (tls[i].off > SPLICE_FROM) {
    if (patchPointer(tls[i].off, tls[i].off, `sec[${i}]@0x${tls[i].off.toString(16)}`)) tlsPatched++;
  }
}
console.log(`(2) top-level section self_offsets patched: ${tlsPatched} (limited to first 16 candidates)`);

// (3) Faction-record self-pointers at +4 and +8 (only those after splice).
let facPatched = 0;
for (const f of facs) {
  if (f > SPLICE_FROM) {
    if (patchPointer(f + 4, f + 4, `fac@0x${f.toString(16)}+4`)) facPatched++;
    if (patchPointer(f + 8, f + 8, `fac@0x${f.toString(16)}+8`)) facPatched++;
  }
}
console.log(`(3) faction-record self-pointers patched: ${facPatched} / ${facs.length * 2}`);

// (4) Trailer offset-index. Per format_notes, the trailer just before
// EOF magic has entries of {u32 self_offset, u16, ...}. EOF magic is the
// last 4 bytes (00 01 01 00). Scan backward from there for u32==own-position.
const EOF_MAGIC_OFF = buf.length - 4;
// Walk backward looking for valid self_offset entries.
let trailerPatched = 0;
for (let p = EOF_MAGIC_OFF - 4; p > EOF_MAGIC_OFF - 4096; p -= 1) {
  if (buf.readUInt32LE(p) === p && p > SPLICE_FROM) {
    if (patchPointer(p, p, `trailer@0x${p.toString(16)}`)) trailerPatched++;
  }
}
console.log(`(4) trailer self_offset entries patched: ${trailerPatched}`);

console.log();
console.log(`TOTAL patches: ${patchCount}`);

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length} (-${buf.length - out.length})`);
