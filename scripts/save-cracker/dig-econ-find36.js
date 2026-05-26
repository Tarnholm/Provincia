// dig-econ-find36.js
// Find the FACTION_ECONOMICS array (36 records). Strategy: look for a u32==36
// count-prefix immediately followed by a fixed-stride run of records. RTW save
// arrays are usually [u32 count][record × count]. We scan the whole file for any
// position p where buf[p]==36 and the bytes after look like a self-describing
// record array (try several candidate strides; require the LAST record to end
// near a sane boundary). Also scan for [u32 36] preceded by a section self-ptr.

const fs = require("fs");
const path = require("path");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(path.join(BASE, "save_arretium pre retrained..sav"));
console.log(`file size 0x${buf.length.toString(16)}`);

// Candidate: a u32==36 with a self-pointer-shaped record array after it.
// We don't know stride. Heuristic: after the count, the record likely begins with
// a self-ptr (==its own offset) like the faction records, OR a small version tag.
//
// First pass: enumerate every u32==36 occurrence, note context, look for ones where
// the SAME small structure repeats. We'll print the 32 bytes after each, then look
// for repetition manually.
const out = [];
for (let p = 0x3000; p + 8 < buf.length; p += 4) {
  if (buf.readUInt32LE(p) !== 36) continue;
  out.push(p);
}
console.log(`\n${out.length} u32==36 (4-aligned) occurrences`);

// For each, test the hypothesis: is buf[p+4 ...] a run of N records that each START
// with a self-pointer? (record[k] at p+4+k*S has u32 == its own offset). Try the
// faction-record style: first field of each record is a self-ptr OR the record is
// preceded by the prior record. We'll instead test: does the value at p+4 look like
// a pointer to p+4 or p+8 (taw section grammar)?
console.log("\n=== candidates where p+4 region looks like a section (self-ptr or version) ===");
let shown = 0;
for (const p of out) {
  const a = buf.readUInt32LE(p + 4);
  const b = buf.readUInt32LE(p + 8);
  const selfish = (a === p + 4) || (a === p + 8) || (a === p) || (b === p + 8) || (b === p + 12);
  if (!selfish) continue;
  const ctx = Array.from(buf.slice(p - 8, p + 40)).map(x => x.toString(16).padStart(2, "0")).join(" ");
  console.log(`  @0x${p.toString(16)} a=0x${a.toString(16)} b=0x${b.toString(16)}  ctx[-8..+40]: ${ctx}`);
  if (++shown > 60) break;
}

// Second approach: section grammar. taw sections are wrapped {u32 offset==pos, u32 size}.
// Look for {self-ptr, size} pairs whose size, divided by 36, gives an integer stride
// (the econ array section). Scan for pairs where u32(p)==p (self) and the region
// [p+8 .. p+8+size] contains exactly 36 sub-records.
console.log("\n=== self-ptr sections whose size/36 is a clean stride (40..400) ===");
let shown2 = 0;
for (let p = 0x3000; p + 8 < buf.length; p += 4) {
  if (buf.readUInt32LE(p) !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 36 * 16 || size > 36 * 2000) continue;
  if (size % 36 !== 0) continue;
  const stride = size / 36;
  if (stride < 8 || stride > 4000) continue;
  console.log(`  section@0x${p.toString(16)} size=${size} stride=${stride}`);
  if (++shown2 > 40) break;
}
