// dig-siege-alex-anchored.js
// Per-record anchored diff for the Byzantium siege. The whole body re-salts
// UUIDs, so we align on STABLE anchors (UTF-16 settlement/region names) and
// diff windows, classifying each diff as ptr-shift / salt vs real.
//
// Anchors:
//   * Byzantium settlement marker (besieged city)
//   * The besieging army: a Macedonian general record near Byzantium. We find
//     it by scanning for "<culture> general\0" pstr (saveCrackerExtras roles)
//     whose region == Byzantium's region, present in BOTH saves.
// For each anchor we compute the inter-save offset delta from the anchor
// position, then diff [anchor-700 .. anchor+1500] byte-by-byte with that delta
// and print only NON-trivial changes (value deltas that are not equal to the
// anchor's own offset delta, i.e. not pure pointer shifts).

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\";
const base = fs.readFileSync(DIR + "save_17-05-2026   Macedon   Turn 1.sav");
const byz  = fs.readFileSync(DIR + "save_17-05-2026   Macedon   Turn 1 besige Byzantium.sav");

function u16le(s) { const t = Buffer.alloc(s.length * 2); for (let i = 0; i < s.length; i++) t.writeUInt16LE(s.charCodeAt(i), i * 2); return t; }
function hexAscii(b, off, n) {
  const lines = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n && off + r + i < b.length; i++) { const x = b[off + r + i]; row.push(x.toString(16).padStart(2, "0")); asc += (x >= 32 && x < 127) ? String.fromCharCode(x) : "."; }
    lines.push(`  0x${(off + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return lines.join("\n");
}
function findMarker(buf, name) {
  for (const flag of [0x01, 0x00]) {
    const t = Buffer.concat([Buffer.from([flag, name.length, 0x00]), u16le(name), Buffer.from([0, 0])]);
    const p = buf.indexOf(t);
    if (p !== -1) return p;
  }
  return -1;
}

const bzBase = findMarker(base, "Byzantium");
const bzByz  = findMarker(byz,  "Byzantium");
console.log(`Byzantium marker: base=0x${bzBase.toString(16)} byz=0x${bzByz.toString(16)} (Δ=${bzByz - bzBase})`);

// Anchored diff: compare base[bzBase+dx] vs byz[bzByz+dx]. Pure pointer
// shifts will appear because pointers inside the record reference absolute
// offsets that moved by (bzByz-bzBase) OR by other insertion sizes. We can't
// know each pointer's shift, so just print all diffs and let me eyeball,
// but coalesce runs and skip the obvious salted-UUID 4-byte fields that sit
// right before the session stamp.
function anchoredDiff(A, aBase, B, bBase, from, to, label) {
  console.log(`\n=== anchored diff: ${label}  (A@0x${aBase.toString(16)} B@0x${bBase.toString(16)}) ===`);
  const runs = []; let cur = null;
  for (let dx = from; dx <= to; dx++) {
    const a = A[aBase + dx], b = B[bBase + dx];
    if (a === undefined || b === undefined) break;
    if (a !== b) { if (cur && dx === cur.e + 1) cur.e = dx; else { cur = { s: dx, e: dx }; runs.push(cur); } }
  }
  console.log(`  ${runs.length} differing runs`);
  for (const r of runs) {
    const len = r.e - r.s + 1;
    const pa = A.slice(aBase + r.s, aBase + r.e + 1).toString("hex");
    const sb = B.slice(bBase + r.s, bBase + r.e + 1).toString("hex");
    console.log(`  dx ${r.s}..${r.e} (${len})  base=[${pa}]  byz=[${sb}]`);
  }
}
anchoredDiff(base, bzBase, byz, bzByz, -700, 1600, "Byzantium record");

// Show the Byzantium record in byz for context (name-200 .. name+300)
console.log("\n=== Byzantium byz record raw (name-64 .. name+200) ===");
console.log(hexAscii(byz, bzByz - 64, 264));
