// splice-with-section-fix.js
//
// TEST D failed with "next < buffer_end Failed" (infinite loop, not crash).
// Hypothesis: the engine walks taw-sections by their SIZE u32. Our 462-byte
// splice left the parent section's size header unchanged, so the iterator
// overshoots by 462 bytes.
//
// This script:
//   (1) Walks the taw-section tree TOP-DOWN from offset 0x3b99 (body root,
//       known constant per format_notes.md). Recursive: each section's
//       payload may contain child sections starting with {u32 self_off, u32 size}.
//   (2) Records every section whose extent CONTAINS the splice point.
//   (3) Records every section whose self_offset > splice_point (these shift
//       in the spliced save).
//   (4) Splices out record #50, patches every (1) section's size by -462,
//       patches every (3) section's self_offset by -462.
//   (5) Writes save_TEST_D2_splice_sectionfix.sav to the RTW saves dir.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D2_splice_sectionfix.sav";
const DEAD = Buffer.from("/portraits/dead/", "ascii");

// === STEP 1: locate record #50 (same logic as test-dead-pool-splice.js) ===
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
  for (let k = 0; k < records.length - 1; k++) {
    records[k].endOff = records[k + 1].lenPrefixOff;
    records[k].byteLen = records[k].endOff - records[k].lenPrefixOff;
  }
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
const r50 = recs[50];
const SPLICE_FROM = r50.lenPrefixOff;
const SPLICE_TO   = r50.endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;
console.log(`Splice: record #50, bytes [0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)}] = ${SPLICE_BYTES} B`);
console.log();

// === STEP 2: walk the taw-section tree top-down ===
// Real section header: u32@p == p AND u32@p+4 in [8, file_remaining].
// A section's payload starts at p+8 and goes for size-8 bytes.
// Recursive: scan the payload for valid sub-section headers.
//
// Top-level roots per format_notes.md: sec[0] @ 0x3b99 plus siblings that
// follow in the body. The body itself has a layout we walk by scanning for
// {u32 self_off, u32 size} headers at byte-granularity. Outermost containers
// are the ones whose start is in the body region (not in HST/header).

const BODY_START = 0x3b99;

function isSection(p) {
  if (p + 8 > buf.length) return false;
  const self = buf.readUInt32LE(p);
  if (self !== p) return false;
  const size = buf.readUInt32LE(p + 4);
  if (size < 8) return false;
  if (p + size > buf.length) return false;
  return true;
}

// Find all REAL top-level (body-region) sections by walking forward from
// BODY_START. Each section either occupies size bytes and the next section
// starts right after it, OR siblings can have gaps. Walk forward picking
// every valid section header as we encounter it.
function findTopLevelSections() {
  const top = [];
  let p = BODY_START;
  while (p + 8 <= buf.length) {
    if (isSection(p)) {
      const size = buf.readUInt32LE(p + 4);
      top.push({ off: p, size });
      p += size; // jump to the next sibling
    } else {
      p++;
    }
  }
  return top;
}

const top = findTopLevelSections();
console.log(`top-level sections starting from 0x${BODY_START.toString(16)}: ${top.length}`);
for (let i = 0; i < Math.min(top.length, 8); i++) {
  console.log(`  sec[${i}] @ 0x${top[i].off.toString(16)}  size=${top[i].size}  end=0x${(top[i].off + top[i].size).toString(16)}`);
}
console.log();

// Identify which top-level section contains the splice.
const containerTop = top.findIndex(s => s.off <= SPLICE_FROM && s.off + s.size > SPLICE_FROM);
if (containerTop < 0) { console.log("FATAL: splice point is not inside any top-level section."); process.exit(1); }
console.log(`splice is inside top-level sec[${containerTop}] @ 0x${top[containerTop].off.toString(16)} size=${top[containerTop].size}`);
console.log();

// Recursively find all sections inside top[containerTop]'s payload that
// contain the splice. Walk inner sections strictly within the payload.
function walkSubsections(sectionOff, sectionSize, containers) {
  const payloadStart = sectionOff + 8;
  const payloadEnd   = sectionOff + sectionSize;
  let p = payloadStart;
  while (p + 8 <= payloadEnd) {
    if (isSection(p)) {
      const subSize = buf.readUInt32LE(p + 4);
      if (p + subSize > payloadEnd) { p++; continue; } // not a real child
      // Is this sub-section a container of the splice?
      if (p <= SPLICE_FROM && p + subSize > SPLICE_FROM) {
        containers.push({ off: p, size: subSize });
        walkSubsections(p, subSize, containers);
        return; // we found the containing path; siblings can't also contain
      }
      p += subSize;
    } else {
      p++;
    }
  }
}

const containers = [{ off: top[containerTop].off, size: top[containerTop].size }];
walkSubsections(top[containerTop].off, top[containerTop].size, containers);

console.log(`section nest containing splice (outermost → innermost): ${containers.length}`);
for (const c of containers) {
  console.log(`  off=0x${c.off.toString(16)}  size=${c.size}  end=0x${(c.off + c.size).toString(16)}`);
}
console.log();

// === STEP 3: find all sections (top-level or nested) whose self_offset > SPLICE_FROM ===
// Those need self_offset decremented by SPLICE_BYTES in the spliced save.
function collectAllSections(sectionOff, sectionSize, list) {
  list.push({ off: sectionOff, size: sectionSize });
  const payloadStart = sectionOff + 8;
  const payloadEnd   = sectionOff + sectionSize;
  let p = payloadStart;
  while (p + 8 <= payloadEnd) {
    if (isSection(p)) {
      const subSize = buf.readUInt32LE(p + 4);
      if (p + subSize > payloadEnd) { p++; continue; }
      collectAllSections(p, subSize, list);
      p += subSize;
    } else {
      p++;
    }
  }
}

const allSections = [];
for (const t of top) collectAllSections(t.off, t.size, allSections);
console.log(`all sections in body: ${allSections.length}`);
const downstream = allSections.filter(s => s.off >= SPLICE_TO);
console.log(`sections at or after splice point (self_offset shift needed): ${downstream.length}`);
console.log();

// === STEP 4: build the spliced + patched buffer ===
const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

// (a) decrement size of each containing section
for (const c of containers) {
  // After splice, this section's position in `out` is c.off (unchanged
  // because it starts at or before SPLICE_FROM).
  const cur = out.readUInt32LE(c.off + 4);
  out.writeUInt32LE(cur - SPLICE_BYTES, c.off + 4);
}

// (b) decrement self_offset of each downstream section
// Each downstream section now sits at (originalOff - SPLICE_BYTES) in `out`.
for (const d of downstream) {
  const newOff = d.off - SPLICE_BYTES;
  // Validate the header still looks like a section before we touch it.
  const here = out.readUInt32LE(newOff);
  if (here !== d.off) {
    console.log(`  WARN: expected self_offset ${d.off} at new pos 0x${newOff.toString(16)}, got ${here}`);
    continue;
  }
  out.writeUInt32LE(newOff, newOff);
}
console.log(`patched ${containers.length} containing-section sizes and ${downstream.length} downstream self_offsets`);
console.log();

fs.writeFileSync(OUT, out);
console.log(`wrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length}  (delta -${buf.length - out.length})`);
