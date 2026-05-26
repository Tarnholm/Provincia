// dig-settle-bigformat.js
//
// Decode the 34MB-save (RIS imperial, self-pointer) settlement record format.
// Structure observed around a settlement name in big saves:
//   [self_ptr A][self_ptr A+4] ... name marker [01|07 nchars 00 UTF16 0000]
//   ... fc fc fc fc ... default_set ... building chains
// pop appears ~-36 before name. Find the self-pointer pair that anchors the
// record and walk fields around it.
//
// Usage: node dig-settle-bigformat.js "<save>" <name>
"use strict";
const { loadSave } = require("./dig-settle-lib");
const buf = loadSave(process.argv[2]);
const name = process.argv[3];

// Find the name marker occurrence(s)
function occ(name) {
  const out = [];
  for (const flag of [0x01, 0x00, 0x07]) {
    const b = Buffer.alloc(3 + name.length * 2 + 2);
    b[0] = flag; b[1] = name.length; b[2] = 0;
    for (let i = 0; i < name.length; i++) { b[3 + i * 2] = name.charCodeAt(i); b[3 + i * 2 + 1] = 0; }
    let p = 0; while ((p = buf.indexOf(b, p)) !== -1) { out.push({ marker: p, flag }); p += 1; }
  }
  return out.sort((a, b) => a.marker - b.marker);
}

for (const o of occ(name)) {
  const m = o.marker;
  // Look back up to 30 bytes for a self-pointer pair: u32(x)==x and u32(x+4 region)
  let selfA = null;
  for (let back = 8; back <= 40; back++) {
    const x = m - back;
    if (x < 0) break;
    if (buf.readUInt32LE(x) === x) { selfA = x; break; }
  }
  console.log(`marker@${m} flag=${o.flag} selfPtr=${selfA}`);
  // Dump u32s from -40..-4 before name and a few after
  const np = m + 1;
  console.log("  pre-name u32s:");
  for (let dx = -44; dx <= -4; dx += 4) {
    const off = np + dx; if (off < 0) continue;
    console.log(`    dx ${String(dx).padStart(4)}  u32=${buf.readUInt32LE(off)}  bytes ${Array.from(buf.slice(off, off+4)).map(x=>x.toString(16).padStart(2,"0")).join(" ")}`);
  }
}
