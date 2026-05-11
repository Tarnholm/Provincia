// dig-buildchain5.js — Focus on Pella's settlement record (default_set #1 in archive saves).
// Dump the full default_set + nearby sub-records and find what changed when construction started.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));

// Pella default_set #1: start@0x10dae, constr@0x10dae
const pellaStart = 0x10dae;

// Dump 200 bytes
console.log("Pella default_set start:");
function dump(buf, label) {
  console.log(`\n${label}:`);
  for (let i = 0; i < 256; i += 16) {
    const row = [];
    const asc = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[pellaStart + i + j];
      row.push(b.toString(16).padStart(2, "0"));
      asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
    }
    console.log(`  +${i.toString().padStart(3)}: ${row.join(" ")}  | ${asc.join("")}`);
  }
}
dump(startBuf, "START");
dump(constrBuf, "CONSTR");

// Now find ALL diffs between start and constr in the Pella region (0x10dae .. 0x12500)
console.log("\nByte diffs in Pella settlement region (0x10dae..0x12500):");
let diffs = [];
for (let i = pellaStart; i < 0x12500; i++) {
  if (startBuf[i] !== constrBuf[i]) {
    diffs.push({ pos: i, before: startBuf[i], after: constrBuf[i] });
  }
}
console.log(`  ${diffs.length} byte diffs`);
// Cluster consecutive diffs
const clusters = [];
let cur = null;
for (const d of diffs) {
  if (cur && d.pos === cur.end + 1) cur.end = d.pos;
  else {
    if (cur) clusters.push(cur);
    cur = { start: d.pos, end: d.pos };
  }
}
if (cur) clusters.push(cur);
console.log(`  ${clusters.length} clusters of consecutive diff bytes`);
for (const c of clusters.slice(0, 50)) {
  const len = c.end - c.start + 1;
  const beforeHex = [];
  const afterHex = [];
  for (let j = c.start; j <= c.end; j++) {
    beforeHex.push(startBuf[j].toString(16).padStart(2, "0"));
    afterHex.push(constrBuf[j].toString(16).padStart(2, "0"));
  }
  console.log(`    @0x${c.start.toString(16)}..0x${c.end.toString(16)} (${len}b): B[${beforeHex.join(" ")}] A[${afterHex.join(" ")}]`);
}
