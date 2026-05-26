// Run the CURRENT helper (parseReligionByCity / scanReligionForSettlement) on
// save_macedon t0.sav and report what it produces, so we know the baseline.
const fs = require("fs");
const cx = require("../../src/saveCrackerExtras.js");
const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);

// Reproduce main.js settlement marker scan
function readUtf16Name(data, pos, len) {
  if (pos + 4 >= len) return null;
  const nchars = data[pos];
  if (nchars < 3 || nchars > 32 || data[pos + 1] !== 0x00) return null;
  const strStart = pos + 2;
  const strEnd = strStart + nchars * 2;
  if (strEnd + 2 > len || data[strEnd] !== 0x00 || data[strEnd + 1] !== 0x00) return null;
  let decoded = "";
  for (let j = strStart; j < strEnd; j += 2) {
    const lo = data[j], hi = data[j + 1];
    if (hi !== 0x00 || lo < 0x20 || lo > 0x7e) return null;
    decoded += String.fromCharCode(lo);
  }
  if (decoded[0] < "A" || decoded[0] > "Z") return null;
  return { name: decoded, end: strEnd + 2 };
}
const len = buf.length;
const settlements = [];
for (let i = 0; i < len - 10; i++) {
  if (buf[i] === 0x01) {
    const r = readUtf16Name(buf, i + 1, len);
    if (r) settlements.push({ offset: i, name: r.name });
  }
}
console.log("settlement markers found:", settlements.length);
// Note: this scan finds MANY non-settlement names too (units/regions). Dedup by name.
const byName = {};
for (const s of settlements) { if (!byName[s.name]) byName[s.name] = []; byName[s.name].push(s.offset); }

const rel = cx.parseReligionByCity(buf, settlements);
const keys = Object.keys(rel);
console.log("religionByCity entries:", keys.length);
console.log("\n=== sample current output (first 40) ===");
keys.slice(0, 40).forEach(k => {
  const r = rel[k];
  console.log("  " + k.padEnd(20) + " dx=" + r.dx + " sum=" + r.sum + " bytes=[" + r.bytes.join(",") + "]");
});

// Distribution of dx (offset from name) to see if it's consistent
const dxCount = {};
keys.forEach(k => { const d = rel[k].dx; dxCount[d] = (dxCount[d]||0)+1; });
console.log("\n=== dx distribution (offset from name where block found) ===");
Object.entries(dxCount).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([d,c])=>console.log("  dx=" + d + ": " + c + " settlements"));
