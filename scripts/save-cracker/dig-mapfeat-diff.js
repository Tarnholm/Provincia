// dig-mapfeat-diff.js
// Shift-aware diff between two saves; report INSERTED runs (present in B, absent
// in A) that are small enough to be a single map-feature record (4..512 bytes).
// For each inserted run, dump its bytes with multi-width decode so coord-like
// (x,y) + faction + type fields become visible.
import fs from "node:fs";
import path from "node:path";
import { diffSmart } from "./diff.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const aName = process.argv[2] || "save_t0.sav";
const bName = process.argv[3] || "save_t1.sav";
const MIN = Number(process.argv[4] || 4);
const MAX = Number(process.argv[5] || 256);

const a = fs.readFileSync(path.join(SAVE_DIR, aName));
const b = fs.readFileSync(path.join(SAVE_DIR, bName));
console.log(`A ${aName} ${a.length.toLocaleString()}  B ${bName} ${b.length.toLocaleString()}  Δsize=${(b.length - a.length).toLocaleString()}`);

const { runs } = diffSmart(a, b);

// Insertions: bytes in B not present in A. aLen of run ~0 (or tiny) but bLen > 0.
const inserts = runs.filter(r => {
  const aLen = r.aEnd - r.aStart;
  const bLen = r.bEnd - r.bStart;
  return bLen - aLen >= MIN && bLen >= MIN;
});

console.log(`\n${runs.length} diff runs, ${inserts.length} look like insertions (Δ>=${MIN})`);

// Histogram of insertion net-size
const hist = {};
for (const r of inserts) {
  const net = (r.bEnd - r.bStart) - (r.aEnd - r.aStart);
  hist[net] = (hist[net] || 0) + 1;
}
console.log("Insert net-size histogram (size: count):");
const sizes = Object.keys(hist).map(Number).sort((x, y) => x - y);
for (const s of sizes) console.log(`   ${String(s).padStart(6)} bytes : ${hist[s]}`);

// Show insertions in the small-record band
const band = inserts.filter(r => {
  const net = (r.bEnd - r.bStart) - (r.aEnd - r.aStart);
  return net >= MIN && net <= MAX;
});
console.log(`\n${band.length} insertions in band ${MIN}..${MAX} bytes — dumping up to 40:`);

function decode(buf, o, n) {
  const lines = [];
  for (let i = 0; i < n; i += 4) {
    if (o + i + 4 > buf.length) break;
    const u32 = buf.readUInt32LE(o + i);
    const u16a = buf.readUInt16LE(o + i), u16b = buf.readUInt16LE(o + i + 2);
    const bytes = Array.from(buf.subarray(o + i, o + i + 4)).map(x => x.toString(16).padStart(2, "0")).join(" ");
    const asc = Array.from(buf.subarray(o + i, o + i + 4)).map(x => (x >= 0x20 && x <= 0x7e) ? String.fromCharCode(x) : ".").join("");
    lines.push(`    +${String(i).padStart(3)}  ${bytes}  ${asc}  u32:${String(u32).padStart(11)}  u16:${u16a},${u16b}`);
  }
  return lines.join("\n");
}

for (const r of band.slice(0, 40)) {
  const net = (r.bEnd - r.bStart) - (r.aEnd - r.aStart);
  console.log(`\n  INSERT @B 0x${r.bStart.toString(16)} (net +${net}B, bLen=${r.bEnd - r.bStart}, aLen=${r.aEnd - r.aStart})  [near A 0x${r.aStart.toString(16)}]`);
  console.log(decode(b, r.bStart, Math.min(r.bEnd - r.bStart, MAX)));
}
