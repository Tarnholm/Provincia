// dig-faction-walk.js — session 5
//
// Walk the section tree of a Rome Remastered .sav (magic 0x070a). The section
// invariant per taw etwng:
//   { u32 absolute_offset (self-pointer), u32 size_bytes (incl 8-byte header), payload[size-8] }
//
// We scan the file for ALL self-pointers (u32 at position X == X) with a
// plausible size, then construct a tree. The root of the body section sits
// somewhere after the header strings table; in rome5 it appears to be at
// 0xaa370 (dossier session 2).
//
// Usage:
//   node dig-faction-walk.js <save-path>
//
const fs = require("fs");
const path = require("path");

function findSelfPointers(buf, { minSize = 16, maxSize = buf.length } = {}) {
  const candidates = [];
  const n = buf.length;
  for (let i = 0; i + 8 <= n; i += 1) {
    const off = buf.readUInt32LE(i);
    if (off !== i) continue;
    const size = buf.readUInt32LE(i + 4);
    if (size < minSize || size > maxSize) continue;
    if (i + size > n) continue;
    candidates.push({ offset: i, size });
  }
  return candidates;
}

function buildSectionTree(candidates) {
  const sorted = [...candidates].sort((a, b) => a.offset - b.offset || (b.size - a.size));
  const tree = [];
  const stack = [];
  for (const c of sorted) {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (c.offset < top.section.offset + top.section.size) break;
      stack.pop();
    }
    const node = { section: c, children: [] };
    if (stack.length === 0) tree.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return tree;
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node dig-faction-walk.js <save-path>");
    process.exit(1);
  }
  console.log("Loading", path.basename(filePath));
  const buf = fs.readFileSync(filePath);
  console.log("Size:", buf.length, "bytes");

  console.log("Scanning for self-pointers...");
  const t0 = Date.now();
  const candidates = findSelfPointers(buf, { minSize: 16, maxSize: buf.length });
  console.log(`Found ${candidates.length} self-pointing sections in ${Date.now() - t0}ms`);

  // Top sections (largest by size)
  const byTop = candidates.filter((c) => c.size > 100000).sort((a, b) => b.size - a.size);
  console.log("\nLargest sections (>100KB):");
  for (const s of byTop.slice(0, 20)) {
    console.log(`  0x${s.offset.toString(16).padStart(8, "0")} size=${s.size} (${(s.size / 1024).toFixed(0)}KB)`);
  }

  // Build tree and dump first 2 levels
  const tree = buildSectionTree(candidates);
  console.log(`\nTop-level sections: ${tree.length}`);
  // Pick the largest top-level section (the body root)
  const root = tree.slice().sort((a, b) => b.section.size - a.section.size)[0];
  console.log(`\nBody root: 0x${root.section.offset.toString(16)} size=${root.section.size} children=${root.children.length}`);

  // Dump first-level children of body root
  console.log("\nFirst-level children of body root (first 50):");
  for (const ch of root.children.slice(0, 50)) {
    console.log(`  0x${ch.section.offset.toString(16).padStart(8, "0")} size=${ch.section.size.toString().padStart(10)} subchildren=${ch.children.length}`);
  }

  // Look for sections containing faction-name strings
  console.log("\nSearching children for faction tokens (romans_julii, carthage, messapians, sparta, athens)");
  const tokens = ["romans_julii", "carthage", "messapians", "sparta", "athens", "FACTION_DATA", "FACTION_ECONOMICS"];
  const hits = {};
  for (const tok of tokens) hits[tok] = [];
  for (let i = 0; i < buf.length - 30; i += 1) {
    if (buf[i] < 0x20 || buf[i] > 0x7e) continue;
    for (const tok of tokens) {
      if (buf.length - i < tok.length) continue;
      let ok = true;
      for (let k = 0; k < tok.length; k += 1) {
        if (buf[i + k] !== tok.charCodeAt(k)) { ok = false; break; }
      }
      if (ok) hits[tok].push(i);
    }
  }
  for (const tok of tokens) {
    console.log(`  ${tok}: ${hits[tok].length} occurrences. First 5: ${hits[tok].slice(0, 5).map((x) => "0x" + x.toString(16)).join(", ")}`);
  }
}

main();
