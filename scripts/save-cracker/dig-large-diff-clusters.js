// Focus only on LARGE change clusters between Spain T4 Start and War.
const fs = require("fs");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const PRE = fs.readFileSync(`${BASE}\\save_Autosave   Spain   Turn 4 Start.sav`);
const POST = fs.readFileSync(`${BASE}\\save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav`);

const minLen = Math.min(PRE.length, POST.length);
const regions = [];
let cur = null;
for (let i = 0; i < minLen; i++) {
  if (PRE[i] !== POST[i]) {
    if (!cur) cur = { start: i, end: i + 1 };
    else cur.end = i + 1;
  } else {
    if (cur) {
      if (i - cur.end > 32) {
        regions.push(cur);
        cur = null;
      }
    }
  }
}
if (cur) regions.push(cur);

// Only show clusters >= 100 bytes
const large = regions.filter(r => (r.end - r.start) >= 100);
console.log(`${regions.length} total clusters, ${large.length} of size >= 100 bytes`);
console.log("\n=== Large clusters (>= 100 bytes) ===");
for (const r of large) {
  const sz = r.end - r.start;
  console.log(`\n0x${r.start.toString(16).padStart(7,'0')}-0x${r.end.toString(16)} (${sz}b)`);
  // First 32 bytes of pre/post side-by-side
  for (let j = 0; j < Math.min(64, sz); j += 16) {
    let preHex = "", postHex = "";
    for (let k = 0; k < 16 && j + k < sz; k++) {
      preHex += PRE[r.start + j + k].toString(16).padStart(2, "0") + " ";
      postHex += POST[r.start + j + k].toString(16).padStart(2, "0") + " ";
    }
    console.log(`  +${j.toString(16).padStart(3, '0')} PRE:  ${preHex}`);
    console.log(`        POST: ${postHex}`);
  }
}

// Also: bytes APPENDED at end of POST (POST.length > PRE.length)
console.log(`\n=== POST appended bytes (last ${POST.length - PRE.length} bytes only in POST) ===`);
const appendStart = PRE.length;
for (let off = appendStart; off < Math.min(appendStart + 256, POST.length); off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = POST[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  console.log(`  0x${off.toString(16)}: ${hex.padEnd(48)} | ${asc}`);
}
