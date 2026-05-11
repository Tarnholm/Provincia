// dig-occupy4.js
// Carefully map all differing fields between the two diffs.
//   D1 = save_9.1 (pre-enslave) → save_10.1 (enslave) — same offset (clean diff)
//   D2 = save_11.1 (Brundisium captured) → save_12.1 (exterminate Uria) — different offsets, aligned by marker
//
// The action enum byte should differ in BOTH diffs (since both are post-conquest action choices).
// But actually D1 is going from pre-conquest to post-conquest-with-enslave-choice (the choice
// is BEING MADE in this step). D2 is exterminate vs occupy? Wait — read brief again.
//
// save_9.1 = stop siege Tarentum (before Uria capture)
// save_10.1 = ENSLAVE Uria
// save_11.1 = captured Brundisium (occupy?)
// save_12.1 = EXTERMINATE Uria
//
// So save_9 → save_10 is: pre-Uria-capture → Uria-enslaved.
// save_11 → save_12 is: post-Brundisium-captured (but Uria still enslaved?) → Uria-exterminated.
//
// Actually save_11.1 happens AFTER save_10.1. So Uria in save_11.1 still reflects ENSLAVE state.
// save_11 → save_12: Uria(enslaved) → Uria(exterminated).
//
// That means in D2, the action enum byte changes from "enslave" → "exterminate".
// In D1, it changes from <some default before-capture> → "enslave".
//
// Both diffs share: enum byte CHANGES (D1: <pre> → enslave; D2: enslave → exterminate).
// The enum byte position should be CONSTANT across both diffs (relative to settlement marker).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function loadAndDiff(fileA, fileB, markerA, markerB, range = [-100, 100]) {
  const A = fs.readFileSync(path.join(SAVE_DIR, fileA));
  const B = fs.readFileSync(path.join(SAVE_DIR, fileB));
  const diffs = [];
  for (let off = range[0]; off < range[1]; off++) {
    if (A[markerA + off] !== B[markerB + off]) {
      diffs.push({ off, a: A[markerA + off], b: B[markerB + off] });
    }
  }
  return { diffs, A, B };
}

console.log("=== D1: save_9.1 → save_10.1 (enslave Uria), Uria-100..+100 ===");
let { diffs: d1, A: a1, B: b1 } = loadAndDiff("save_9.1.sav", "save_10.1.sav", 0x1264861, 0x1264861, [-100, 100]);
for (const d of d1) {
  console.log(`  Uria${d.off >= 0 ? "+" : ""}${d.off}: 0x${d.a.toString(16).padStart(2, "0")} → 0x${d.b.toString(16).padStart(2, "0")}`);
}

console.log("\n=== D2: save_11.1 → save_12.1 (exterminate Uria), Uria-100..+100 ===");
let { diffs: d2 } = loadAndDiff("save_11.1.sav", "save_12.1.sav", 0x12693c6, 0x1264861, [-100, 100]);
for (const d of d2) {
  console.log(`  Uria${d.off >= 0 ? "+" : ""}${d.off}: 0x${d.a.toString(16).padStart(2, "0")} → 0x${d.b.toString(16).padStart(2, "0")}`);
}

// Print bytes near marker in detail for both pairs
console.log("\n=== Bytes at Uria marker (-50..+50) for all 4 saves ===");
const M9 = 0x1264861, M10 = 0x1264861, M11 = 0x12693c6, M12 = 0x1264861;
const buffers = {
  "save_9.1":  [fs.readFileSync(path.join(SAVE_DIR, "save_9.1.sav")),  M9],
  "save_10.1": [fs.readFileSync(path.join(SAVE_DIR, "save_10.1.sav")), M10],
  "save_11.1": [fs.readFileSync(path.join(SAVE_DIR, "save_11.1.sav")), M11],
  "save_12.1": [fs.readFileSync(path.join(SAVE_DIR, "save_12.1.sav")), M12],
};

for (const [name, [buf, m]] of Object.entries(buffers)) {
  console.log(`\n${name} (marker @ 0x${m.toString(16)}):`);
  for (let off = -50; off < 50; off += 10) {
    const hex = buf.slice(m + off, m + off + 10).toString("hex");
    const lbl = `${off >= 0 ? "+" : ""}${off}`.padStart(4, " ");
    console.log(`  Uria${lbl}: ${hex}`);
  }
}
