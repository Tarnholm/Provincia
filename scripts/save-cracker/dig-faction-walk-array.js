// dig-faction-walk-array.js — session 5
//
// Hypothesis: 20000 at 0x162f838 is Ptolemaic treasury. The "1e 00 00 00" at
// +24 may be Ptolemaic's faction-id (30 in this campaign). The record extends
// some distance, with another 20000 dup at 0x162f910 (216 bytes later).
//
// Look around for the array start/end. We'll back-walk and look for any
// other faction's treasury u32 nearby. We're looking for ~216 bytes per
// record (or some other stride).
const fs = require("fs");

function findU32In(buf, lo, hi, target) {
  const out = [];
  for (let i = lo; i + 4 <= hi; i += 1) {
    if (buf.readUInt32LE(i) === target) out.push(i);
  }
  return out;
}

function dump(buf, start, len) {
  console.log(`\n=== 0x${start.toString(16)}..0x${(start + len).toString(16)} ===`);
  for (let i = 0; i < len; i += 32) {
    const here = start + i;
    if (here >= buf.length) break;
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
  console.log("File size:", buf.length);

  // Look for all known starting wealth values in a window around 0x162f838.
  const wealth = JSON.parse(require("fs").readFileSync("public/faction_wealth_large.json", "utf8"));
  const wealthSet = new Set(Object.values(wealth));
  const lo = 0x162e000;
  const hi = 0x1630000;
  console.log(`Scan window: 0x${lo.toString(16)} .. 0x${hi.toString(16)} = ${hi - lo} bytes`);

  // For each position, check if u32 is a known wealth value.
  const wealthHits = [];
  for (let i = lo; i + 4 <= hi; i += 1) {
    const v = buf.readUInt32LE(i);
    if (wealthSet.has(v)) wealthHits.push({ pos: i, value: v });
  }
  console.log(`\nHits in window (any starting wealth value):`);
  for (const h of wealthHits.slice(0, 80)) {
    // Identify which faction(s) have this wealth
    const fs = Object.entries(wealth).filter(([, w]) => w === h.value).map(([n]) => n);
    console.log(`  0x${h.pos.toString(16)} = ${h.value} (${fs.length === 1 ? fs[0] : fs.length + " factions"})`);
  }

  // Look at the 16-byte stride record before 0x162f838 — what is it?
  console.log("\n--- 16-byte-stride record array preceding the 20000 ---");
  console.log("First record at 0x162f600:");
  dump(buf, 0x162f600, 16);
  console.log("Entry 5 at 0x162f670 (5*16=80 bytes in):");
  dump(buf, 0x162f680, 16);

  // The "02 00 00 00" appearing after each 16-byte entry in the second array...
  console.log("\n--- 16-byte-stride record array after 20000 dup ---");
  console.log("Record at 0x162f9b0:");
  for (let r = 0; r < 5; r += 1) dump(buf, 0x162f9b0 + 16 * r, 16);
}

main();
