// Within-turn diff: Spain Turn 1 vs Turn 1 + spy moved.
// Smallest possible diff = just position bytes of the spy character.
const fs = require("fs");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const PRE = fs.readFileSync(`${BASE}\\save_17-05-2026   Spain   Turn 1.sav`);
const POST = fs.readFileSync(`${BASE}\\save_17-05-2026   Spain   Turn 1 move spy.sav`);

console.log(`PRE: ${PRE.length}, POST: ${POST.length}, delta ${POST.length - PRE.length}`);

const minLen = Math.min(PRE.length, POST.length);
const regions = [];
let cur = null;
for (let i = 0; i < minLen; i++) {
  if (PRE[i] !== POST[i]) {
    if (!cur) cur = { start: i, end: i + 1 };
    else cur.end = i + 1;
  } else {
    if (cur) {
      if (i - cur.end > 16) {
        regions.push(cur);
        cur = null;
      }
    }
  }
}
if (cur) regions.push(cur);

console.log(`\n${regions.length} change clusters (gap > 16 bytes)`);
console.log("=== ALL clusters ===");
for (const r of regions) {
  const sz = r.end - r.start;
  console.log(`\n0x${r.start.toString(16).padStart(7,'0')}-0x${r.end.toString(16)} (${sz}b)`);
  // Show up to 32 bytes of context
  const ctxStart = Math.max(0, r.start - 4);
  const ctxLen = Math.min(48, sz + 8);
  const preHex = Array.from(PRE.slice(ctxStart, ctxStart + ctxLen)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const postHex = Array.from(POST.slice(ctxStart, ctxStart + ctxLen)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  pre:  ${preHex}`);
  console.log(`  post: ${postHex}`);
}

// File-size delta — what's APPENDED?
if (POST.length > PRE.length) {
  console.log(`\n=== Appended ${POST.length - PRE.length} bytes at end of POST ===`);
  const appStart = PRE.length;
  for (let off = appStart; off < Math.min(appStart + 64, POST.length); off += 16) {
    let hex = "", asc = "";
    for (let i = 0; i < 16; i++) {
      const b = POST[off + i];
      hex += b.toString(16).padStart(2, "0") + " ";
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
    }
    console.log(`  0x${off.toString(16)}: ${hex} | ${asc}`);
  }
}
