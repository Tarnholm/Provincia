// dig-faction-walk4.js — session 5
//
// Focus: find the immediate enclosing self-pointing section of each
// romans_julii / sparta / carthage / etc. occurrence. Then look at sibling
// sections of the same size to identify a faction record array.
const fs = require("fs");
const path = require("path");

function findSelfPointers(buf, maxSize = 16 * 1024 * 1024) {
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

function findOccurrences(buf, tok) {
  const out = [];
  const tokBytes = Buffer.from(tok, "utf8");
  for (let i = 0; i < buf.length - tokBytes.length; i += 1) {
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
  const buf = fs.readFileSync(filePath);
  console.log("File:", path.basename(filePath), buf.length, "bytes");

  console.log("\n# Scan small-medium self-pointers (size 16..2MB)");
  const cands = findSelfPointers(buf, 2 * 1024 * 1024);
  console.log(`Found ${cands.length} candidate sections (size 16..2MB)`);

  // Build offset map for binary search.
  cands.sort((a, b) => a.offset - b.offset);
  const offsets = cands.map((c) => c.offset);

  function findContaining(addr) {
    // Find all sections whose [offset, offset+size) contains addr.
    // Linear scan over all cands but bounded sections only.
    const matches = [];
    for (const c of cands) {
      if (c.offset > addr) break;
      if (c.offset + c.size > addr) matches.push(c);
    }
    return matches;
  }

  // Anchor near a known character record (Leonidas at 0x0154a708) — we know
  // the section grammar applies there. Use it as a sanity check.
  console.log("\nSanity check: sections containing 0x0154a708 (Leonidas position record area)");
  const sanity = findContaining(0x0154a708);
  for (const s of sanity.slice(-10)) {
    console.log(`  sec 0x${s.offset.toString(16)} sz=${s.size}`);
  }

  // For each faction occurrence, find the SMALLEST enclosing section.
  const tokens = ["romans_julii", "sparta", "carthage", "athens", "macedon", "armenia"];
  for (const tok of tokens) {
    const occ = findOccurrences(buf, tok);
    if (occ.length === 0) continue;
    console.log(`\n## ${tok} (${occ.length} occurrences)`);
    for (const o of occ) {
      const matches = findContaining(o);
      if (matches.length === 0) {
        console.log(`  0x${o.toString(16)} → no enclosing section`);
        continue;
      }
      const sm = matches.reduce((a, b) => (b.size < a.size ? b : a));
      console.log(`  0x${o.toString(16)} → smallest enc: 0x${sm.offset.toString(16)} sz=${sm.size} (enc-count=${matches.length})`);
    }
  }
}

main();
