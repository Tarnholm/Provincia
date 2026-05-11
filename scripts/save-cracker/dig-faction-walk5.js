// dig-faction-walk5.js — session 5
//
// Drill into the second giant top-level section at 0x0100e7ff (8MB). Faction
// tokens (romans_julii etc.) live inside this. Find the immediate children
// and look for fixed-stride arrays.
const fs = require("fs");
const path = require("path");

function findSelfPointers(buf, lo, hi, maxSize = hi - lo) {
  const out = [];
  for (let i = lo; i + 8 <= hi; i += 1) {
    const off = buf.readUInt32LE(i);
    if (off !== i) continue;
    const size = buf.readUInt32LE(i + 4);
    if (size < 16 || size > maxSize) continue;
    if (i + size > hi) continue;
    out.push({ offset: i, size });
  }
  return out;
}

function findOccurrences(buf, tok, lo, hi) {
  const out = [];
  const tokBytes = Buffer.from(tok, "utf8");
  for (let i = lo; i < hi - tokBytes.length; i += 1) {
    if (buf[i] !== tokBytes[0]) continue;
    let ok = true;
    for (let k = 1; k < tokBytes.length; k += 1) {
      if (buf[i + k] !== tokBytes[k]) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

function main() {
  const filePath = process.argv[2];
  const targetOff = parseInt(process.argv[3] || "0x0100e7ff", 16);
  const buf = fs.readFileSync(filePath);
  console.log("File:", path.basename(filePath), buf.length);

  // Read the section header
  const off = buf.readUInt32LE(targetOff);
  const size = buf.readUInt32LE(targetOff + 4);
  console.log(`Section at 0x${targetOff.toString(16)}: self=0x${off.toString(16)} size=${size} end=0x${(targetOff + size).toString(16)}`);
  if (off !== targetOff) { console.log("Not a valid section. Abort."); return; }

  const lo = targetOff + 8;  // payload start
  const hi = targetOff + size;
  console.log(`Payload range: 0x${lo.toString(16)}..0x${hi.toString(16)} (${hi - lo} bytes)`);

  // Find immediate children (sub-sections that are top-level within this range)
  const sub = findSelfPointers(buf, lo, hi, hi - lo);
  console.log(`Sub-sections found: ${sub.length}`);

  // Filter to top-level children (sections not contained in any other section in the same range)
  sub.sort((a, b) => a.offset - b.offset);
  const topChildren = [];
  let curEnd = lo;
  for (const s of sub) {
    if (s.offset >= curEnd) {
      topChildren.push(s);
      curEnd = s.offset + s.size;
    }
  }
  console.log(`Top-level children inside this section: ${topChildren.length}`);
  console.log("\nFirst 30:");
  for (const s of topChildren.slice(0, 30)) {
    console.log(`  0x${s.offset.toString(16).padStart(8, "0")} size=${s.size.toString().padStart(10)}`);
  }
  console.log("\nLast 10:");
  for (const s of topChildren.slice(-10)) {
    console.log(`  0x${s.offset.toString(16).padStart(8, "0")} size=${s.size.toString().padStart(10)}`);
  }

  // Look at child size distribution
  const sizes = topChildren.map((c) => c.size);
  const sizeCounts = {};
  for (const sz of sizes) sizeCounts[sz] = (sizeCounts[sz] || 0) + 1;
  const sorted = Object.entries(sizeCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log("\nMost common child sizes:");
  for (const [sz, cnt] of sorted) {
    console.log(`  size=${sz} count=${cnt}`);
  }

  // Where are the faction tokens relative to the children?
  console.log("\nFaction token locations within this section:");
  const tokens = ["romans_julii", "sparta", "carthage", "athens", "macedon"];
  for (const t of tokens) {
    const occs = findOccurrences(buf, t, lo, hi);
    if (occs.length === 0) continue;
    console.log(`\n  ${t} (${occs.length} occurrences):`);
    for (const o of occs.slice(0, 8)) {
      // Find which top-level child contains o
      const ch = topChildren.find((c) => o >= c.offset && o < c.offset + c.size);
      const relToCh = ch ? (o - ch.offset) : null;
      console.log(`    0x${o.toString(16)} ${ch ? `in child 0x${ch.offset.toString(16)} (rel +${relToCh}, child sz ${ch.size})` : "loose"}`);
    }
  }
}

main();
