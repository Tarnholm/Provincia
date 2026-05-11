// dig-buildchain8.js — Pella's default_set at 0x10dae in BOTH saves. The settlement record
// is at the same offset because the construction insertion is FAR later in the file.
// So I can compare byte-for-byte at the same offset within Pella's settlement.
//
// Find the EXACT changes inside Pella's record.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));

const PELLA_START = 0x10dae;
const NEXT_SETTLEMENT = 0x1157e; // default_set #2 in both saves

console.log(`Pella region: 0x${PELLA_START.toString(16)} .. 0x${NEXT_SETTLEMENT.toString(16)} (${NEXT_SETTLEMENT-PELLA_START} bytes)`);

// Confirm both saves have default_set at same offset 0x1157e
function findAll(buf, tok) {
  const out = [];
  const t = Buffer.from(tok);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    if (p - 2 >= 0 && buf.readUInt16LE(p - 2) === tok.length + 1 && buf[p + tok.length] === 0) out.push(p);
    p += 1;
  }
  return out;
}
const cH = findAll(constrBuf, "default_set");
console.log(`Constr default_set positions (first 5): ${cH.slice(0, 5).map(x=>x.toString(16)).join(", ")}`);
// Yes, both saves have default_set #2 at 0x1157e (= 0x115b3 in constr).
// Wait — let me check Pella's actual size.

// Find the END of Pella record in start: next default_set
const sH = findAll(startBuf, "default_set");
console.log(`Start default_set positions (first 5): ${sH.slice(0, 5).map(x=>x.toString(16)).join(", ")}`);

// In start: Pella ends at 0x1157e. In constr: Pella ends at...?
// (because if Pella's sub-records grew, the next settlement would shift)
// constr's #2 default_set is at 0x115b3 according to my earlier output... but that's only 53 bytes shift.
const pellaStartEnd_start = sH[2];
const pellaStartEnd_constr = cH[2];
console.log(`Pella ends: start=0x${pellaStartEnd_start.toString(16)}, constr=0x${pellaStartEnd_constr.toString(16)}, growth=${pellaStartEnd_constr - pellaStartEnd_start}`);

// So Pella GREW by some number of bytes when construction started.
// Diff the region byte-by-byte until growth limit.
const pellaLen = pellaStartEnd_start - PELLA_START;
console.log(`Pella record size (start) = ${pellaLen}`);

// Find the insertion point inside Pella: where do start and constr first diverge?
let firstDiff = -1;
for (let i = PELLA_START; i < pellaStartEnd_start; i++) {
  if (startBuf[i] !== constrBuf[i]) { firstDiff = i; break; }
}
console.log(`First Pella diff: 0x${firstDiff.toString(16)} (offset within Pella: ${firstDiff - PELLA_START})`);

// Show bytes around firstDiff in both
console.log("\nContext around first diff in Pella:");
for (let i = 0; i < 40; i++) {
  const pos = firstDiff - 16 + i;
  if (pos < PELLA_START || pos > pellaStartEnd_start) continue;
  const s = startBuf[pos], c = constrBuf[pos];
  console.log(`  0x${pos.toString(16)}: B=0x${s.toString(16).padStart(2, "0")} ${(s>=0x20&&s<0x7f)?String.fromCharCode(s):"."} | C=0x${c.toString(16).padStart(2, "0")} ${(c>=0x20&&c<0x7f)?String.fromCharCode(c):"."} ${s !== c ? " **" : ""}`);
}

// Now find ALL diffs within Pella (without worrying about alignment for now)
const diffs = [];
for (let i = PELLA_START; i < pellaStartEnd_start; i++) {
  if (startBuf[i] !== constrBuf[i]) diffs.push({ off: i - PELLA_START, b: startBuf[i], a: constrBuf[i] });
}
console.log(`\nTotal raw byte diffs in Pella's start region: ${diffs.length}`);
// Show the first 30
for (const d of diffs.slice(0, 80)) {
  console.log(`  +${d.off}: 0x${d.b.toString(16).padStart(2, "0")} → 0x${d.a.toString(16).padStart(2, "0")}`);
}
