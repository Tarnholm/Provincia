// dig-section-walker4.js — strict-filter section walker.
//
// Filter rules (cumulative):
// 1. Self-pointer must equal offset (basic invariant).
// 2. size >= 16, offset+size <= file_length.
// 3. The section must NOT be at random alignment inside another section's
//    "interior data" — accepted only if its parent-walker reaches it cleanly
//    by walking [start ... [child], [data ... child], [data ... child]].
// 4. Walking the parent's payload sequentially: at each position, check
//    if the next u32 is a self-pointer. If yes, advance by section size.
//    If no, advance by a single u32 (treat as data). Track which sections are
//    reached via this clean sequential walk.

const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
console.log(`File: ${path.basename(SAVE)} (${buf.length} bytes)`);

// Find HST end
const hst = [];
{
  let i = 0x3000;
  while (i < 0x4000) {
    if (!(buf[i] >= 0x41 && buf[i] <= 0x5a)) { i++; continue; }
    const ns = i;
    while (i < buf.length) {
      const b = buf[i];
      if ((b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39) || b === 0x5f) i++;
      else break;
    }
    if (buf[i] !== 0) { i++; continue; }
    const ver = buf.readUInt32LE(i + 1);
    if (ver < 1 || ver > 16) { i++; continue; }
    hst.push({ name: buf.slice(ns, i).toString('ascii'), ver });
    i += 5;
  }
}
const hstEnd = 0x3b99 - 2; // hardcoded body root start

function isSection(p, maxEnd) {
  if (p + 8 > maxEnd) return false;
  if (buf.readUInt32LE(p) !== p) return false;
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 16 || p + sz > maxEnd) return false;
  return true;
}

// Sequential walker: starting at start, walk the parent's payload looking for
// child sections at any u32-aligned position. Tracks each consumed section.
function walkSequential(start, end, maxSections = 50000) {
  // The body's grammar is NOT a clean section-only stream — it's interleaved with
  // data (small ints, strings, arrays). So we look for self-pointers as ANCHORS
  // and accept them when they fit cleanly.
  // Strategy: scan all candidate sections in [start..end] at u32 alignment, then
  // greedily accept non-overlapping ones.
  const found = [];
  for (let p = start; p + 8 <= end; p += 4) {
    if (!isSection(p, end)) continue;
    found.push({ off: p, size: buf.readUInt32LE(p + 4) });
  }
  // Greedy non-overlap
  found.sort((a, b) => a.off - b.off || b.size - a.size);
  const accepted = [];
  let lastEnd = start;
  for (const s of found) {
    if (s.off < lastEnd) continue;
    accepted.push(s);
    lastEnd = s.off + s.size;
    if (accepted.length >= maxSections) break;
  }
  return accepted;
}

// Body root walk
const bodyRoot = { off: 0x3b99, size: buf.readUInt32LE(0x3b99 + 4) };
console.log(`Body root @0x${bodyRoot.off.toString(16)} size=${bodyRoot.size}`);
const bodyKids = walkSequential(bodyRoot.off + 8, bodyRoot.off + bodyRoot.size);
console.log(`Body root direct children (greedy non-overlap): ${bodyKids.length}`);

// Past the body root, find next top-level section
const bodyEnd = bodyRoot.off + bodyRoot.size;
let nextTop = -1;
// Walk through padding and find a self-pointer
for (let p = bodyEnd; p < buf.length; p += 4) {
  if (isSection(p, buf.length)) {
    // Sanity: size should be moderate (not 17MB false positive)
    // Try to validate: the section's payload should have something that looks
    // like a child OR be substantive content.
    nextTop = p;
    break;
  }
}
console.log(`Next top-level section after body root: 0x${nextTop.toString(16)} size=${buf.readUInt32LE(nextTop+4)}`);

const sectionB = { off: nextTop, size: buf.readUInt32LE(nextTop + 4) };
const sectionBKids = walkSequential(sectionB.off + 8, sectionB.off + sectionB.size, 5000);
console.log(`Section B direct children: ${sectionBKids.length}`);

// Classify
function classify(s) {
  const p = s.off + 8;
  const lookahead = Math.min(s.size - 8, 4096);
  const slice = buf.slice(p, p + lookahead);
  if (slice.indexOf(Buffer.from("data/ui/", "ascii")) >= 0) return "char_record";
  if (slice.indexOf(Buffer.from("default_set", "ascii")) >= 0) return "settlement_record";
  if (slice.indexOf(Buffer.from("core_building", "ascii")) >= 0) return "settlement_record";
  if (s.size >= 64 && buf.readUInt32LE(p) === 100 && buf.readUInt32LE(p + 4) === 1) return "faction_record";
  // UTF-16LE-named settlement: bytes 0..3 are u16 lenA + first UTF-16LE char
  if (s.size >= 32 && buf[p+1] === 0 && buf[p+3] === 0 && buf[p+0] >= 0x41 && buf[p+0] <= 0x7e) return "utf16_named";
  // Mostly zeros?
  let nzero = 0;
  for (let i = 0; i < Math.min(lookahead, 256); i++) if (slice[i] === 0) nzero++;
  if (nzero > 200) return "mostly_zero";
  if (s.size < 100) return "small";
  return "unknown";
}

function classifyAll(kids, label) {
  const cls = {};
  const szByCls = {};
  for (const k of kids) {
    const c = classify(k);
    cls[c] = (cls[c] || 0) + 1;
    if (!szByCls[c]) szByCls[c] = [];
    szByCls[c].push(k.size);
  }
  console.log(`\n${label} classification:`);
  for (const [c, n] of Object.entries(cls).sort((a, b) => b[1] - a[1])) {
    const sizes = szByCls[c];
    const avg = (sizes.reduce((s, v) => s + v, 0) / sizes.length).toFixed(0);
    console.log(`  ${String(n).padStart(5)} × ${c.padEnd(20)} size avg=${avg} min=${Math.min(...sizes)} max=${Math.max(...sizes)}`);
  }
}

classifyAll(bodyKids, "Body root");
classifyAll(sectionBKids, "Section B (16MB settlement zone)");

// Continue walking after section B
const sBEnd = sectionB.off + sectionB.size;
let posC = sBEnd;
while (posC + 8 < buf.length) {
  if (isSection(posC, buf.length)) break;
  posC += 4;
}
if (posC + 8 < buf.length) {
  const sectionC = { off: posC, size: buf.readUInt32LE(posC + 4) };
  console.log(`\nSection C (after B) @0x${sectionC.off.toString(16)} size=${sectionC.size}`);
  if (sectionC.off + sectionC.size <= buf.length) {
    const cKids = walkSequential(sectionC.off + 8, sectionC.off + sectionC.size, 5000);
    console.log(`Section C direct children: ${cKids.length}`);
    classifyAll(cKids, "Section C");
  }
}

// Summary
console.log(`\nFile geography summary:`);
console.log(`  Header + HST: 0x0..0x${hstEnd.toString(16)} (${hstEnd} bytes)`);
console.log(`  Body root: 0x${bodyRoot.off.toString(16)}..0x${bodyEnd.toString(16)} (${bodyRoot.size} bytes), kids=${bodyKids.length}`);
console.log(`  Padding/gap: 0x${bodyEnd.toString(16)}..0x${sectionB.off.toString(16)} (${sectionB.off - bodyEnd} bytes)`);
console.log(`  Section B: 0x${sectionB.off.toString(16)}..0x${(sectionB.off+sectionB.size).toString(16)} (${sectionB.size} bytes), kids=${sectionBKids.length}`);
