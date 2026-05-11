// dig-faction-tops.js — session 5
//
// Find ALL top-level sections (not contained inside any other self-pointing
// section). Show them sorted by offset to see how the file is structured.
const fs = require("fs");
const path = require("path");

function findSelfPointers(buf, maxSize = buf.length) {
  const out = [];
  for (let i = 0; i + 8 <= buf.length; i += 1) {
    const off = buf.readUInt32LE(i);
    if (off !== i) continue;
    const size = buf.readUInt32LE(i + 4);
    if (size < 16 || size > maxSize) continue;
    if (i + size > buf.length) continue;
    out.push({ offset: i, size });
  }
  return out;
}

function main() {
  const filePath = process.argv[2];
  const buf = fs.readFileSync(filePath);
  console.log("File:", path.basename(filePath), buf.length);

  // Use only sane-size sections (>= 16, <= 8MB) to avoid false positives.
  const cands = findSelfPointers(buf, 8 * 1024 * 1024);
  console.log(`Candidates (size 16..8MB): ${cands.length}`);

  cands.sort((a, b) => a.offset - b.offset);

  // Find top-level non-overlapping cover: greedy by offset.
  // Tag each as "contained in" the smallest other section that contains it.
  // Then top-levels are those with no container.
  // For efficiency, sort by offset and use a stack-based approach.
  // Top-level = section whose offset is not strictly inside any prior section.

  const topLevel = [];
  const stack = []; // sections whose end is > current section's offset
  for (const c of cands) {
    // Pop any from stack that have ended
    while (stack.length && stack[stack.length - 1].offset + stack[stack.length - 1].size <= c.offset) {
      stack.pop();
    }
    if (stack.length === 0) {
      topLevel.push(c);
    }
    stack.push(c);
  }
  console.log(`\nTop-level sections: ${topLevel.length}`);
  for (const s of topLevel) {
    console.log(`  0x${s.offset.toString(16).padStart(8, "0")} size=${s.size.toString().padStart(10)} end=0x${(s.offset + s.size).toString(16)}`);
  }

  // Check coverage: do these top-levels cover the file from 0x3b99 onward?
  let cur = topLevel[0]?.offset || 0;
  const gaps = [];
  for (const s of topLevel) {
    if (s.offset > cur) gaps.push({ from: cur, to: s.offset, size: s.offset - cur });
    cur = Math.max(cur, s.offset + s.size);
  }
  console.log(`\nGaps between top-level sections (first 30):`);
  for (const g of gaps.slice(0, 30)) {
    console.log(`  gap 0x${g.from.toString(16)}..0x${g.to.toString(16)} sz=${g.size}`);
  }

  // The romans_julii at 0x150366e — which top-level contains it?
  const tok = 0x150366e;
  const containing = topLevel.find((s) => tok >= s.offset && tok < s.offset + s.size);
  console.log(`\nTop-level containing 0x150366e (romans_julii):`, containing ? `0x${containing.offset.toString(16)} sz=${containing.size}` : "none");
}

main();
