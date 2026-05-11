// dig-faction-array.js — session 5
//
// The 956KB chunk at 0x01243c5e holds zero self-pointing sub-sections — it's
// a flat data block. Likely the faction array. Total ~956KB / N factions ≈
// per-faction-record stride. RIS has ~239 factions per descr_strat. 956362/239
// ≈ 4000 bytes per record. The dossier hypothesized "~2KB stride".
//
// Approach:
//   - Hex-dump the start of this section
//   - Look for repeating header patterns at suspected stride boundaries
//   - Identify potential fixed-stride sub-records inside
const fs = require("fs");
const path = require("path");

function hex(buf, start, len) {
  const end = Math.min(start + len, buf.length);
  let s = "";
  for (let i = start; i < end; i += 1) {
    s += buf[i].toString(16).padStart(2, "0") + " ";
    if ((i - start) % 16 === 15) s += "\n  ";
  }
  return s;
}

function ascii(buf, start, len) {
  const end = Math.min(start + len, buf.length);
  let s = "";
  for (let i = start; i < end; i += 1) {
    const b = buf[i];
    s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
  }
  return s;
}

function dumpRange(buf, start, len) {
  console.log(`\n=== 0x${start.toString(16)}..0x${(start + len).toString(16)} ===`);
  for (let i = 0; i < len; i += 32) {
    const here = start + i;
    let hexp = "";
    let asc = "";
    for (let k = 0; k < 32 && here + k < buf.length; k += 1) {
      hexp += buf[here + k].toString(16).padStart(2, "0") + " ";
      const c = buf[here + k];
      asc += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ".";
    }
    console.log(`  0x${here.toString(16).padStart(8, "0")}  ${hexp.padEnd(96)} |${asc}|`);
  }
}

function main() {
  const filePath = process.argv[2];
  const buf = fs.readFileSync(filePath);

  const targetOff = 0x01243c5e;
  const size = buf.readUInt32LE(targetOff + 4);
  const lo = targetOff + 8;
  const hi = targetOff + size;
  console.log(`Faction array candidate at 0x${targetOff.toString(16)}: size=${size} payload=${hi - lo} bytes`);

  // First 128 bytes
  dumpRange(buf, lo, 128);

  // Heuristic: scan for repeated 4-byte signatures that could be record start
  // markers. Count u32 values that appear many times.
  const u32Counts = new Map();
  for (let i = lo; i + 4 <= hi; i += 1) {
    const v = buf.readUInt32LE(i);
    if (v === 0 || v === 0xffffffff) continue;
    u32Counts.set(v, (u32Counts.get(v) || 0) + 1);
  }
  const topU32 = Array.from(u32Counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log("\nTop repeated u32 values (excl 0 / 0xffffffff):");
  for (const [v, c] of topU32) {
    console.log(`  0x${v.toString(16).padStart(8, "0")} (${v}) count=${c}`);
  }

  // Look for repeated 8-byte signatures
  const u64Counts = new Map();
  for (let i = lo; i + 8 <= hi; i += 1) {
    const a = buf.readUInt32LE(i);
    const b = buf.readUInt32LE(i + 4);
    if ((a === 0 && b === 0) || (a === 0xffffffff && b === 0xffffffff)) continue;
    const key = a.toString(16) + "_" + b.toString(16);
    u64Counts.set(key, (u64Counts.get(key) || 0) + 1);
  }
  const topU64 = Array.from(u64Counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("\nTop repeated 8-byte sigs:");
  for (const [k, c] of topU64) {
    console.log(`  ${k} count=${c}`);
  }

  // Hypothesis: each faction record starts at a known stride. Try strides
  // 2048, 4000, 3998, 956362/239.
  const stride = Math.floor((hi - lo) / 239);
  console.log(`\nIf 239 factions: stride ≈ ${stride}`);
  // Dump record starts at hypothesized strides for first 5 records
  for (let r = 0; r < 5; r += 1) {
    const off = lo + r * stride;
    if (off + 32 > hi) break;
    console.log(`\nRecord ${r} @ 0x${off.toString(16)}:`);
    console.log(`  ${hex(buf, off, 32)} |${ascii(buf, off, 32)}|`);
  }
}

main();
