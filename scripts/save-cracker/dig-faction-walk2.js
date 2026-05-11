// dig-faction-walk2.js — session 5
//
// Refined: use sections with offsets in body root, deeper exploration. Focus
// on finding the per-faction array. We know faction strings exist; we need to
// find the array that contains them.
//
// Strategy:
// 1. Find self-pointing sections more strictly (size <= 8MB, with valid
//    inner self-pointer at offset+12 a la character record, or any sane
//    nested structure).
// 2. Build a deep tree.
// 3. Show sections that CONTAIN faction name occurrences, sorted by depth.
// 4. Within each candidate parent, list the immediate children sizes —
//    a fixed-size array should produce uniform child sizes.
const fs = require("fs");
const path = require("path");

function findSelfPointers(buf, opts = {}) {
  const minSize = opts.minSize ?? 16;
  const maxSize = opts.maxSize ?? buf.length;
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
    const node = { section: c, children: [], parent: stack[stack.length - 1] || null };
    if (stack.length === 0) tree.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return tree;
}

function findOccurrences(buf, tok) {
  const out = [];
  const tokBytes = Buffer.from(tok, "utf8");
  let i = 0;
  while (i < buf.length - tokBytes.length) {
    let ok = true;
    for (let k = 0; k < tokBytes.length; k += 1) {
      if (buf[i + k] !== tokBytes[k]) { ok = false; break; }
    }
    if (ok) {
      out.push(i);
      i += 1;
    } else {
      i += 1;
    }
  }
  return out;
}

function findEnclosingSection(tree, offset) {
  // Find the smallest section that contains `offset`. We walk the tree.
  let best = null;
  function visit(node) {
    const s = node.section;
    if (offset < s.offset || offset >= s.offset + s.size) return;
    if (!best || s.size < best.section.size) best = node;
    for (const c of node.children) visit(c);
  }
  for (const r of tree) visit(r);
  return best;
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node dig-faction-walk2.js <save-path>");
    process.exit(1);
  }
  console.log("Loading", path.basename(filePath));
  const buf = fs.readFileSync(filePath);
  console.log("Size:", buf.length, "bytes");

  console.log("Scanning self-pointers...");
  const candidates = findSelfPointers(buf, { minSize: 16, maxSize: buf.length });
  console.log(`Found ${candidates.length} sections`);

  const tree = buildSectionTree(candidates);
  console.log(`Top-level: ${tree.length}`);

  // Faction tokens. Use the player-visible IDs (sparta, romans_julii, carthage, athens).
  const tokens = [
    "romans_julii", "carthage", "sparta", "athens",
    "romans_brutii", "romans_scipii", "macedon", "egypt",
    "pontus", "armenia", "parthia", "seleucid",
  ];
  console.log("\nOccurrences:");
  const occ = {};
  for (const t of tokens) {
    occ[t] = findOccurrences(buf, t);
    if (occ[t].length === 0) continue;
    console.log(`  ${t}: ${occ[t].length}`);
  }

  // For each occurrence of romans_julii, find the smallest enclosing section.
  console.log("\nEnclosing sections for romans_julii occurrences:");
  for (const off of occ.romans_julii.slice(0, 20)) {
    const enc = findEnclosingSection(tree, off);
    if (!enc) { console.log(`  0x${off.toString(16)} → no section`); continue; }
    const s = enc.section;
    console.log(`  off=0x${off.toString(16)} sec=0x${s.offset.toString(16)} sz=${s.size} children=${enc.children.length}`);
  }

  // Same for sparta and athens
  console.log("\nEnclosing sections for sparta occurrences:");
  for (const off of occ.sparta.slice(0, 10)) {
    const enc = findEnclosingSection(tree, off);
    if (!enc) { console.log(`  0x${off.toString(16)} → no section`); continue; }
    const s = enc.section;
    console.log(`  off=0x${off.toString(16)} sec=0x${s.offset.toString(16)} sz=${s.size} children=${enc.children.length}`);
  }

  console.log("\nEnclosing sections for carthage occurrences:");
  for (const off of occ.carthage.slice(0, 10)) {
    const enc = findEnclosingSection(tree, off);
    if (!enc) { console.log(`  0x${off.toString(16)} → no section`); continue; }
    const s = enc.section;
    console.log(`  off=0x${off.toString(16)} sec=0x${s.offset.toString(16)} sz=${s.size} children=${enc.children.length}`);
  }
}

main();
