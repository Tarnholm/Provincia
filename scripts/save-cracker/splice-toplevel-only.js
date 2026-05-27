// splice-toplevel-only.js — D4: minimum-confidence patch.
//
// D3 also hung with "next < buffer_end". My 4-deep nested-container walker
// likely found false positives — inner "section headers" that are just
// coincidental {u32 self_offset, u32 size}-looking bytes inside dense data,
// not real sections.
//
// D4 retreats to the safest possible patch: ONLY the top-level section
// that contains the splice (sec[1] @ 0x1026c67 for this save). Top-level
// sections are highest-confidence because they sit at known structural
// positions (sec[0] @ 0x3ba9 is the constant body-root per format_notes).
//
// If D4 loads → the inner patches in D3 were corrupting real data, and
//   top-level-only size patching is the pruner path.
// If D4 still hangs → the engine reads count/size from somewhere we
//   haven't located. Probably need to look at section-internal length
//   prefixes per-record, not just outer section size.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D4_toplevel_only.sav";
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

// Walk top-level siblings ONLY. Use sibling-jump (p += size) — this gives
// the canonical top-level layout per format_notes.md.
let topContainer = null;
{
  let p = BODY_START;
  while (p + 8 <= buf.length) {
    if (isSection(p)) {
      const size = buf.readUInt32LE(p + 4);
      if (p <= SPLICE_FROM && p + size > SPLICE_FROM) { topContainer = { off: p, size }; break; }
      p += size;
    } else p++;
  }
}
if (!topContainer) { console.log("FATAL: no top-level section contains splice"); process.exit(1); }

console.log(`top-level container: 0x${topContainer.off.toString(16)} size=${topContainer.size}`);
console.log(`splice: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (${SPLICE_BYTES} B)`);
console.log();

const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));
const oldSize = out.readUInt32LE(topContainer.off + 4);
out.writeUInt32LE(oldSize - SPLICE_BYTES, topContainer.off + 4);
console.log(`patched top-level section size: ${oldSize} -> ${oldSize - SPLICE_BYTES}`);

fs.writeFileSync(OUT, out);
console.log(`wrote ${OUT}`);
