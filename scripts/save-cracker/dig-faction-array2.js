// dig-faction-array2.js — session 5
//
// 20000 (Ptolemaic) sits at 0x0162f838 AND 0x0162f910 — 216 bytes apart.
// Hypothesis: these are two records, possibly start-of-array adjacent. Let's
// scan around for the faction record array boundaries.
const fs = require("fs");

function dump(buf, start, len) {
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

  // Walk backward from 0x162f838 to find the array start. Look for u32=20000 (Ptolemaic)
  // and other known-treasury markers like u32=10000 (Romans Julii/Carthage) etc.
  console.log("# Walking backward from 0x162f838 to find faction array start");
  dump(buf, 0x162f600, 600);

  console.log("\n\n# Walking forward from 0x162f910 to find the next records");
  dump(buf, 0x162f910, 800);
}

main();
