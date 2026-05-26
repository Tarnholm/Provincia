// dig-trade-body-sections.js
// Walk the body root and enumerate top-level sections. The body serialises
// section INSTANCES; the registry (read separately) lists 106 types with
// instance counts in declaration order. RR's serializer writes sections in a
// fixed order, and many sections carry a leading u32 "type tag" we can try to
// correlate. Here we just dump the body section list + payload signatures so we
// can locate the RESOURCE/ECONOMICS data by structure.
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_17-05-2026   Spain   Turn 1.sav";
const buf = fs.readFileSync(SAVE);

// Read registry to get type list + counts (located right after header)
function readRegistry() {
  // find start: scan 0x500..0x800 for first [u32 count][asciiz] that yields >50 entries
  for (let s = 0x540; s < 0x800; s++) {
    let p = s, out = [], ok = true;
    for (let i = 0; i < 120; i++) {
      if (p + 5 > buf.length) { ok = false; break; }
      const count = buf.readUInt32LE(p);
      let q = p + 4, str = "";
      while (q < buf.length && buf[q] >= 0x20 && buf[q] < 0x7f) { str += String.fromCharCode(buf[q]); q++; }
      if (buf[q] !== 0 || str.length < 2 || str.length > 50) break;
      out.push({ count, name: str }); p = q + 1;
    }
    if (out.length > 80) return { start: s, types: out, end: p };
  }
  return null;
}
const reg = readRegistry();
console.log("registry types:", reg ? reg.types.length : 0, "ends at 0x" + (reg ? reg.end.toString(16) : "?"));

// Find body root: first self-pointing section after the registry.
function isSection(p, maxEnd) {
  if (p + 8 > maxEnd) return false;
  if (buf.readUInt32LE(p) !== p) return false;
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 16 || p + sz > buf.length) return false;
  return true;
}
let bodyRoot = null;
for (let p = reg.end; p < reg.end + 0x4000; p += 1) {
  if (isSection(p, buf.length)) { bodyRoot = { off: p, size: buf.readUInt32LE(p + 4) }; break; }
}
console.log("body root @0x" + (bodyRoot ? bodyRoot.off.toString(16) : "?"), "size", bodyRoot ? bodyRoot.size : 0);

// Walk direct children of body root.
function walk(start, end) {
  const found = [];
  for (let p = start; p + 8 <= end; p += 4) {
    if (isSection(p, end)) found.push({ off: p, size: buf.readUInt32LE(p + 4) });
  }
  found.sort((a, b) => a.off - b.off || b.size - a.size);
  const acc = []; let lastEnd = start;
  for (const s of found) { if (s.off < lastEnd) continue; acc.push(s); lastEnd = s.off + s.size; }
  return acc;
}
const kids = walk(bodyRoot.off + 8, bodyRoot.off + bodyRoot.size);
console.log("body root children:", kids.length);
console.log("\nfirst 60 children (off, size, first 4 u32 of payload):");
for (let i = 0; i < Math.min(60, kids.length); i++) {
  const k = kids[i];
  const po = k.off + 8;
  const u = [];
  for (let j = 0; j < 5 && po + j * 4 + 4 <= k.off + k.size; j++) u.push(buf.readUInt32LE(po + j * 4));
  console.log(`  [${i}] @0x${k.off.toString(16)} sz=${String(k.size).padStart(7)} payload=${u.join(",")}`);
}
