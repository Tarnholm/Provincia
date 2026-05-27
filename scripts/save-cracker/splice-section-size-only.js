// splice-section-size-only.js — safer variant of splice-with-section-fix.
//
// Same splice (record #50, -462 B), same container-size patches, but
// DOES NOT touch downstream self_offsets. If the engine doesn't actually
// read self_offset as a validation field, this is the cleanest fix.
//
// Outcomes:
//   D2 loads but D3 doesn't → engine reads self_offsets too (need both fixes)
//   D3 loads but D2 doesn't → my offset patcher corrupted random bytes
//   Both load → size fix alone is enough (D2's extra patches were harmless)
//   Neither loads with same error → containers list is incomplete (more
//                                  layers of nesting we missed)

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D3_splice_sizeonly.sav";
const DEAD = Buffer.from("/portraits/dead/", "ascii");
const BODY_START = 0x3b99;

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
    const lenPrefixOff = dataOff - 2;
    const pathLen = buf.readUInt16LE(lenPrefixOff);
    if (pathLen < 16 || pathLen > 200) { from = i + DEAD.length; continue; }
    records.push({ lenPrefixOff, pathStart: dataOff, pathLen });
    from = dataOff + pathLen;
  }
  for (let k = 0; k < records.length - 1; k++) records[k].endOff = records[k + 1].lenPrefixOff;
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
const r50 = recs[50];
const SPLICE_FROM = r50.lenPrefixOff;
const SPLICE_TO   = r50.endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;

function isSection(p) {
  if (p + 8 > buf.length) return false;
  if (buf.readUInt32LE(p) !== p) return false;
  const size = buf.readUInt32LE(p + 4);
  return size >= 8 && p + size <= buf.length;
}

// Find sec[N] containing the splice by walking forward sibling-style.
let p = BODY_START;
let containerTop = null;
while (p + 8 <= buf.length) {
  if (isSection(p)) {
    const size = buf.readUInt32LE(p + 4);
    if (p <= SPLICE_FROM && p + size > SPLICE_FROM) { containerTop = { off: p, size }; break; }
    p += size;
  } else p++;
}
if (!containerTop) { console.log("FATAL: no top-level section contains splice"); process.exit(1); }
console.log(`top container: 0x${containerTop.off.toString(16)} size=${containerTop.size}`);

// Recursive child walker — collect ALL ancestors of the splice point.
const containers = [containerTop];
function descend(off, size) {
  const payloadStart = off + 8;
  const payloadEnd   = off + size;
  let p = payloadStart;
  while (p + 8 <= payloadEnd) {
    if (isSection(p)) {
      const ss = buf.readUInt32LE(p + 4);
      if (p + ss > payloadEnd) { p++; continue; }
      if (p <= SPLICE_FROM && p + ss > SPLICE_FROM) {
        containers.push({ off: p, size: ss });
        descend(p, ss);
        return;
      }
      p += ss;
    } else p++;
  }
}
descend(containerTop.off, containerTop.size);
console.log(`container chain (outer→inner):`);
for (const c of containers) console.log(`  off=0x${c.off.toString(16)}  size=${c.size}`);

// Splice + patch only the container sizes.
const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));
for (const c of containers) {
  const cur = out.readUInt32LE(c.off + 4);
  out.writeUInt32LE(cur - SPLICE_BYTES, c.off + 4);
}
fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}  (-${SPLICE_BYTES} B)`);
console.log(`patched ${containers.length} container sizes; NO self_offset edits`);
