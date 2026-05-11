// dig-faction-walk3.js — session 5
//
// The "body root at 0x3b99 sz=6.49MB" only reaches to 0x630xxx, but faction
// name strings live way past that (around 0x1500000 = 21MB). So either:
//   (a) There are multiple top-level sections after the first, or
//   (b) The section grammar isn't a simple top-level tree — maybe the file
//       contains a stream of side-by-side sections after the body root.
//
// Strategy: list ALL top-level sections sorted by offset. Don't filter by max
// size; let huge spurious entries through and we can ignore them by checking
// whether they extend past file end or overlap other tops.
//
// Also: look at sections containing the faction token offsets directly. Maybe
// the enclosing section IS one of those huge "29MB"-looking sections.
const fs = require("fs");
const path = require("path");

function findSelfPointers(buf) {
  const out = [];
  for (let i = 0; i + 8 <= buf.length; i += 1) {
    const off = buf.readUInt32LE(i);
    if (off !== i) continue;
    const size = buf.readUInt32LE(i + 4);
    if (size < 16 || size > buf.length - i) continue;
    out.push({ offset: i, size });
  }
  return out;
}

function main() {
  const filePath = process.argv[2];
  const buf = fs.readFileSync(filePath);
  console.log("Size:", buf.length);

  const cands = findSelfPointers(buf);
  console.log("Total candidates:", cands.length);

  // Sort by offset and pick a non-overlapping cover of the file.
  cands.sort((a, b) => a.offset - b.offset);

  // Greedy cover: pick the largest section starting at each offset that
  // doesn't overlap the previous pick.
  const cover = [];
  let cur = 0;
  while (cur < buf.length) {
    // Find the largest candidate at offset >= cur with offset == cur OR the
    // first candidate that starts exactly at cur.
    let best = null;
    // Try exact start at cur
    for (const c of cands) {
      if (c.offset < cur) continue;
      if (c.offset > cur) {
        // Don't skip — record gap and break
        if (!best) {
          cur = c.offset;
          break;
        }
      } else if (c.offset === cur) {
        if (!best || c.size > best.size) best = c;
      }
    }
    if (!best) break;
    cover.push(best);
    cur = best.offset + best.size;
  }
  console.log("\nGreedy cover sections:");
  for (const s of cover) {
    console.log(`  0x${s.offset.toString(16).padStart(8, "0")} size=${s.size.toString().padStart(10)} (end=0x${(s.offset+s.size).toString(16)})`);
  }

  // Find romans_julii occurrences and report which cover section contains them
  const tokBytes = Buffer.from("romans_julii", "utf8");
  const occ = [];
  for (let i = 0; i < buf.length - tokBytes.length; i += 1) {
    if (buf[i] !== tokBytes[0]) continue;
    let ok = true;
    for (let k = 1; k < tokBytes.length; k += 1) {
      if (buf[i + k] !== tokBytes[k]) { ok = false; break; }
    }
    if (ok) occ.push(i);
  }
  console.log("\nromans_julii occurrences and their containing cover-section:");
  for (const o of occ) {
    const cover_s = cover.find((s) => o >= s.offset && o < s.offset + s.size);
    console.log(`  0x${o.toString(16)} → ${cover_s ? "cover sec 0x" + cover_s.offset.toString(16) + " sz=" + cover_s.size : "outside any cover"}`);
  }
}

main();
