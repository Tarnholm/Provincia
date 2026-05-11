// dig-occupy5.js
// Look further out from the Uria marker for the action enum. The action choice
// might be in the settlement-record header that extends much further before/after.
//
// Per brief, settlement record fields known:
//   -21 = 0xcb signature
//   +28 = owner-turn-tag (actually this is a u32 turn-tag, we saw turn-tick at -28 too)
//   +62 = size
//   +341/+345 = X/Y coords
//   +683 = per-turn income
//   +775 = pop u32
//   +819 = growth multiplier
//   +2239 = happiness f32
//
// Let me dump first +0..+50 fields as u32, and find -21 = 0xcb pattern to locate
// the broader settlement record start.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function read(name) { return fs.readFileSync(path.join(SAVE_DIR, name)); }

const saves = {
  "save_9.1":  [read("save_9.1.sav"),  0x1264861],
  "save_10.1": [read("save_10.1.sav"), 0x1264861],
  "save_11.1": [read("save_11.1.sav"), 0x12693c6],
  "save_12.1": [read("save_12.1.sav"), 0x1264861],
};

// Per brief: -21 = 0xcb signature. So settlement record header starts at marker-21.
// But more importantly find where the action enum could live: search for bytes
// that change between save_9 and save_10 AND between save_11 and save_12.

const A = read("save_9.1.sav");
const B = read("save_10.1.sav");
const C = read("save_11.1.sav");
const D = read("save_12.1.sav");

const M9 = 0x1264861, M10 = 0x1264861, M11 = 0x12693c6, M12 = 0x1264861;

// Search range relative to Uria marker
const RANGE = [-2000, 5000];
const d1Off = new Set(), d2Off = new Set();
for (let off = RANGE[0]; off < RANGE[1]; off++) {
  if (A[M9 + off] !== B[M10 + off]) d1Off.add(off);
  if (C[M11 + off] !== D[M12 + off]) d2Off.add(off);
}

// Bytes that change in BOTH diffs (likely the action enum)
const inBoth = [...d1Off].filter(o => d2Off.has(o)).sort((a, b) => a - b);

console.log(`D1 (enslave) bytes changing: ${d1Off.size}`);
console.log(`D2 (exterminate) bytes changing: ${d2Off.size}`);
console.log(`Bytes changing in BOTH: ${inBoth.length}`);
console.log();

// Cluster the "both" offsets
const runs = [];
let curS = null, curE = null;
for (const o of inBoth) {
  if (curS === null) { curS = o; curE = o; }
  else if (o - curE <= 4) curE = o;
  else { runs.push([curS, curE]); curS = o; curE = o; }
}
if (curS !== null) runs.push([curS, curE]);

console.log("Runs that differ in BOTH diffs:");
for (const [s, e] of runs) {
  const aHex = A.slice(M9 + s, M9 + e + 1).toString("hex");
  const bHex = B.slice(M10 + s, M10 + e + 1).toString("hex");
  const cHex = C.slice(M11 + s, M11 + e + 1).toString("hex");
  const dHex = D.slice(M12 + s, M12 + e + 1).toString("hex");
  console.log(`  Uria${s >= 0 ? "+" : ""}${s}..${e}, len=${e-s+1}:`);
  console.log(`    save_9.1:  ${aHex}`);
  console.log(`    save_10.1: ${bHex}    (enslave: A→B)`);
  console.log(`    save_11.1: ${cHex}`);
  console.log(`    save_12.1: ${dHex}    (exterminate: C→D)`);
}
