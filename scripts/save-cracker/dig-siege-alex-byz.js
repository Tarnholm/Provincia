// dig-siege-alex-byz.js
// CLEANEST controlled siege experiment: same Turn-1 baseline, only difference
// is the player besieged Byzantium (city, +592B) or a fort (+159B).
//   baseline = "...Turn 1.sav"
//   byz      = "...Turn 1 besige Byzantium.sav"   (+592)
//   fort     = "...Turn 1 besige fort.sav"        (+159)
// Bound the inserted region with prefix/suffix; dump it (this is the SIEGE
// RECORD itself). Then check whether it sits inside Byzantium's settlement
// record or the besieging army record, and decode its fields.

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\";
const base = fs.readFileSync(DIR + "save_17-05-2026   Macedon   Turn 1.sav");
const byz  = fs.readFileSync(DIR + "save_17-05-2026   Macedon   Turn 1 besige Byzantium.sav");
const fort = fs.readFileSync(DIR + "save_17-05-2026   Macedon   Turn 1 besige fort.sav");

function hexAscii(b, off, n) {
  const lines = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n; i++) { const x = b[off + r + i]; row.push(x.toString(16).padStart(2, "0")); asc += (x >= 32 && x < 127) ? String.fromCharCode(x) : "."; }
    lines.push(`  0x${(off + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return lines.join("\n");
}
function commonPrefix(a, b) { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a[i] === b[i]) i++; return i; }
function commonSuffix(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length-1-i] === b[b.length-1-i]) i++; return i; }

function bound(A, B, label) {
  const pre = commonPrefix(A, B), suf = commonSuffix(A, B);
  console.log(`\n=== ${label} (Δ=${B.length-A.length}) ===`);
  console.log(`  prefix=0x${pre.toString(16)} suffix=0x${suf.toString(16)}`);
  console.log(`  inserted region in B: 0x${pre.toString(16)} .. 0x${(B.length-suf).toString(16)} = ${(B.length-suf)-pre} bytes`);
  return { pre, suf };
}

// --- Byzantium ---
const bz = bound(base, byz, "baseline -> besige Byzantium");
console.log("\n--- inserted bytes (Byzantium siege) ---");
console.log(hexAscii(byz, bz.pre - 32, ((byz.length - bz.suf) - bz.pre) + 64));
console.log("\n--- baseline at same offset (for context) ---");
console.log(hexAscii(base, bz.pre - 32, 96));

// --- Fort ---
const ft = bound(base, fort, "baseline -> besige fort");
console.log("\n--- inserted bytes (fort siege) ---");
console.log(hexAscii(fort, ft.pre - 32, ((fort.length - ft.suf) - ft.pre) + 64));

// Where is Byzantium settlement marker relative to the inserted region?
function u16le(s) { const t = Buffer.alloc(s.length * 2); for (let i = 0; i < s.length; i++) t.writeUInt16LE(s.charCodeAt(i), i * 2); return t; }
function findMarkers(buf, name) {
  const a = []; let p = 0;
  for (const flag of [0x01, 0x00]) {
    const t = Buffer.concat([Buffer.from([flag, name.length, 0x00]), u16le(name), Buffer.from([0, 0])]);
    p = 0; while ((p = buf.indexOf(t, p)) !== -1) { a.push(p); p++; }
  }
  return a;
}
const byzM = findMarkers(byz, "Byzantium");
console.log(`\nByzantium markers in byz save: ${byzM.map(o => "0x" + o.toString(16)).join(", ")}`);
console.log(`inserted region starts at 0x${bz.pre.toString(16)}`);
for (const m of byzM) console.log(`  insert - Byzantium marker = ${bz.pre - m}`);
