// dig-mp4.js — find all diff CLUSTERS in the position-aligned region [0..0x2080000].
// We know 0x43f8 is the RNG counter and we know there's a 10-byte insertion
// somewhere; the bulk of diffs at 0x2080000+ are alignment shift.

"use strict";
const fs = require("fs");
const bufB = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_before.sav");
const bufA = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_after.sav");

// Find the LAST position-aligned diff before alignment breaks.
// We do this by scanning forward and looking at where it transitions from
// "occasional cluster" to "massive run".
const SCAN_END = 0x2080000;
const diffs = [];
for (let i = 0; i < SCAN_END; i++) {
  if (bufB[i] !== bufA[i]) diffs.push(i);
}
console.log("position-aligned diffs in [0..0x2080000]:", diffs.length);

// Cluster (gap <= 16)
const clusters = [];
let s = -1, e = -1;
for (const d of diffs) {
  if (s < 0) { s = d; e = d + 1; }
  else if (d <= e + 16) { e = d + 1; }
  else { clusters.push([s, e]); s = d; e = d + 1; }
}
if (s >= 0) clusters.push([s, e]);
console.log("clusters:", clusters.length);

// Look at all clusters with detailed read
function fmt(buf, s, e) {
  const len = e - s;
  let out = "";
  for (let i = 0; i < Math.min(len, 64); i++) {
    out += buf[s + i].toString(16).padStart(2, "0");
  }
  return out + (len > 64 ? "..." : "");
}

const MANIUS = 0x15073f5;

for (const [s, e] of clusters) {
  const relManius = s - MANIUS;
  console.log(`\nCluster abs=${s.toString(16)}..${e.toString(16)} (len ${e - s}, ${relManius >= 0 ? "+" : ""}${relManius} from Manius)`);
  console.log(`  BEF: ${fmt(bufB, s, e)}`);
  console.log(`  AFT: ${fmt(bufA, s, e)}`);
  // Try aligned reads at every offset within the cluster
  const len = e - s;
  for (let off = 0; off + 4 <= len; off++) {
    const ub = bufB.readUInt32LE(s + off);
    const ua = bufA.readUInt32LE(s + off);
    if (ub === ua) continue;
    const ib = bufB.readInt32LE(s + off);
    const ia = bufA.readInt32LE(s + off);
    const u16b = bufB.readUInt16LE(s + off);
    const u16a = bufA.readUInt16LE(s + off);
    let extra = "";
    if (Math.abs(ub) < 1e7 && Math.abs(ua) < 1e7) extra += `  u32 ${ub}→${ua} (Δ${ua - ub})`;
    if (u16b !== u16a && Math.abs(u16b - u16a) < 200) extra += `  u16@${off} ${u16b}→${u16a} (Δ${u16a - u16b})`;
    if (extra) console.log(`    off+${off}:${extra}`);
  }
}
