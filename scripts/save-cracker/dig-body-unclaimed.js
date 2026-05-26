// dig-body-unclaimed.js — show what's UNCLAIMED in the body root after all
// known sub-parsers have run. Specifically focus on the [0x100000..0xf8fd2)
// range that holds the section grammar tree but isn't covered by per-record
// parsers.
"use strict";
const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_item limit bug.sav";
const buf = fs.readFileSync(SAVE);
console.log(`save: ${SAVE} (${buf.length} B)`);

// Hex-sample the region [0x100000..0x800000] at 0x10000 strides
console.log("\nHex sample 0x100000..0x800000 @ 0x10000 stride:");
for (let off = 0x100000; off < 0x800000; off += 0x80000) {
  const slice = buf.slice(off, off + 64);
  const hex = slice.toString("hex").match(/.{2}/g).join(" ");
  const asc = Array.from(slice).map(c => c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ".").join("");
  console.log(`  0x${off.toString(16)}: ${hex}`);
  console.log(`           ${" ".repeat(0)}${asc}`);
}

// Find ASCII tokens (uppercase) inside body root [0x3bad..0xf8fd2)
console.log("\n=== ASCII uppercase tokens in body root [0x3bad..0xf8fd2) ===");
const tokens = {};
let p = 0x3bad;
const end = 0xf8fd2;
while (p < end) {
  if (buf[p] >= 0x41 && buf[p] <= 0x5a) {
    let q = p;
    while (q < end && ((buf[q] >= 0x41 && buf[q] <= 0x5a) || (buf[q] >= 0x30 && buf[q] <= 0x39) || buf[q] === 0x5f)) q++;
    const len = q - p;
    if (len >= 6 && len <= 50) {
      const name = buf.slice(p, q).toString("ascii");
      if (/^[A-Z][A-Z_0-9]*$/.test(name)) {
        tokens[name] = (tokens[name] || 0) + 1;
      }
    }
    p = q;
  } else p++;
}
const interesting = Object.entries(tokens).sort((a,b)=>b[1]-a[1]).slice(0,30);
for (const [name, n] of interesting) {
  console.log(`  ${name.padEnd(45)} ${n}`);
}
