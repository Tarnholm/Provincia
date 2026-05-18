// Look for a contiguous run of small u32 values (0..188) somewhere in
// the save. That'd be a per-character portrait index table.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
const u16 = (o) => buf[o] | (buf[o + 1] << 8);

// Walk the save in steps of 4, looking for runs of u32 values all in [0, 188].
// Require at least 100 consecutive small values (we have 109 generals).
const MAX = 188;
const MIN_RUN = 100;
let runStart = -1;
let runLen = 0;
const runs = [];
for (let off = 0x100; off + 4 <= buf.length; off += 4) {
  const v = u32(off);
  if (v <= MAX) {
    if (runStart < 0) runStart = off;
    runLen++;
  } else {
    if (runLen >= MIN_RUN) runs.push({ start: runStart, len: runLen });
    runStart = -1;
    runLen = 0;
  }
}
if (runLen >= MIN_RUN) runs.push({ start: runStart, len: runLen });
console.log(`runs of >= ${MIN_RUN} small u32s: ${runs.length}`);
for (const r of runs.slice(0, 20)) {
  console.log(`  0x${r.start.toString(16)}  len=${r.len}  first 10: [${Array.from({length: 10}, (_, i) => u32(r.start + i * 4)).join(",")}]`);
}

// Also try u16 (in case index is u16-sized)
const u16Runs = [];
let s = -1, l = 0;
for (let off = 0x100; off + 2 <= buf.length; off += 2) {
  const v = u16(off);
  if (v <= MAX) {
    if (s < 0) s = off;
    l++;
  } else {
    if (l >= MIN_RUN * 2) u16Runs.push({ start: s, len: l });
    s = -1; l = 0;
  }
}
console.log(`\nu16 runs of >= ${MIN_RUN * 2} small values: ${u16Runs.length}`);
for (const r of u16Runs.slice(0, 10)) {
  console.log(`  0x${r.start.toString(16)}  len=${r.len}`);
}

// Also try u8 runs
const u8Runs = [];
let s8 = -1, l8 = 0;
for (let off = 0x100; off < buf.length; off++) {
  const v = buf[off];
  if (v <= MAX) {
    if (s8 < 0) s8 = off;
    l8++;
  } else {
    if (l8 >= MIN_RUN * 4) u8Runs.push({ start: s8, len: l8 });
    s8 = -1; l8 = 0;
  }
}
console.log(`\nu8 runs of >= ${MIN_RUN * 4} small bytes: ${u8Runs.length}`);
for (const r of u8Runs.slice(0, 5)) {
  console.log(`  0x${r.start.toString(16)}  len=${r.len}`);
}
