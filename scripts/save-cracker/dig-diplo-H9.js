// dig-diplo-H9.js — session 109 step H9
//
// Search backward from each marker for ASCII faction-name strings (the
// engine often embeds factionId strings). Or find any length-prefixed
// string in the 256B before each marker.
//
// Also: dump the LARGER context (256B) for marker @0x154e338 (major[0])
// and locate the faction-name that owns this record.
//
// Usage: node dig-diplo-H9.js
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_10_fresh.sav");
const buf = fs.readFileSync(SAVE);

function readMajor(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}
const majors = readMajor(buf);

const markers = [];
for (let i = 0; i + 4 < buf.length; i++) {
  if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) markers.push(i);
}
const valid = markers.filter((off) => {
  const count = buf.readUInt32LE(off + 4);
  if (count > 200 || count === 0) return false;
  for (let k = 0; k < count; k++) {
    const e = off + 8 + k * 16;
    if (e + 16 > buf.length) return false;
    if (buf[e + 12] !== 0x01 || buf[e + 13] !== 0x01 || buf[e + 14] !== 0x01 || buf[e + 15] !== 0x00) return false;
  }
  return true;
});

const majorMarkerSet = new Set(majors.map((m) => m.pos + 244 + 4 * m.regions));

// For each marker, walk 1024 bytes backward looking for ASCII faction
// names (length-prefixed: u16 len then `len` ASCII bytes).
function findAsciiNamesBefore(off, lookbackBytes) {
  const names = [];
  for (let p = Math.max(0, off - lookbackBytes); p + 6 < off; p++) {
    const len = buf.readUInt16LE(p);
    if (len < 4 || len > 32) continue;
    if (p + 2 + len > off) continue;
    let ok = true;
    for (let k = 0; k < len; k++) {
      const c = buf[p + 2 + k];
      if (c < 0x30 || c > 0x7a) { ok = false; break; }
      // allow letters digits underscore
      if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f)) { ok = false; break; }
    }
    if (!ok) continue;
    const s = buf.slice(p + 2, p + 2 + len).toString("ascii");
    names.push({ rel: p - off, len, s });
  }
  return names;
}

console.log(`=== Scan for ASCII length-prefixed strings within 4096B before each marker (first 25 markers) ===`);
const factionNameByMarker = [];
for (let i = 0; i < Math.min(valid.length, 25); i++) {
  const off = valid[i];
  const isMajor = majorMarkerSet.has(off);
  const names = findAsciiNamesBefore(off, 4096);
  // Filter to ones that look like faction names (not random codes)
  const ranked = names.filter((n) => n.len >= 5 && /^[a-z_]+$/i.test(n.s)).slice(-5);
  console.log(`  m[${i.toString().padStart(3)}] @0x${off.toString(16)} ${isMajor ? "MAJ" : "out"}  nearby names: ${ranked.map((n) => `(${n.rel},"${n.s}")`).join(" ")}`);
  factionNameByMarker.push({ markerOff: off, isMajor, names: ranked });
}

// In particular, look at marker @0x154e338 (major[0]) and try to find the
// faction name. Scan the 8KB before it.
console.log(`\n=== Major[0] marker 0x154e338 — names within 8KB before ===`);
const first = 0x154e338;
const allNames = findAsciiNamesBefore(first, 8192).filter((n) => n.len >= 4 && /^[a-z_]+$/i.test(n.s));
allNames.forEach((n) => console.log(`  rel=${n.rel}  "${n.s}"`));

// Also examine the records BETWEEN markers. From H5, we saw between markers
// there's tens-of-thousands of bytes. The marker[3]@0x1554b94 (outside,
// count=41) is BETWEEN major[0]@0x154e338 and major[1]@0x158d633. So
// this is an "extra" record between major[0] and major[1].
//
// Maybe these are SUB-FACTION records (e.g., for senate, factions tied
// to a major)?

// Critical: the 0x39240005 marker zone is part of a LARGER record
// structure. Find the record START by looking for a recognizable head
// pattern. The 16B preamble before marker is `01 00 00 00, 0, 7, 0` —
// possibly a record-end marker rather than head.
//
// Try: find where the PREVIOUS record's end is, by walking backward
// looking for the same `[u32 count][count×16B]` shape ending some bytes
// before each marker.

// Locate the END of the PREVIOUS marker zone, then the gap between it
// and the next marker is the head of the next record.
console.log(`\n=== Record start hypothesis: previous-marker end → this-marker start ===`);
for (let i = 1; i < Math.min(valid.length, 30); i++) {
  const prev = valid[i - 1];
  const cur = valid[i];
  const prevCount = buf.readUInt32LE(prev + 4);
  const prevEnd = prev + 8 + prevCount * 16;
  const gap = cur - prevEnd;
  console.log(`  prev @0x${prev.toString(16)} ends @0x${prevEnd.toString(16)}  →  cur @0x${cur.toString(16)}  gap=${gap}`);
}
