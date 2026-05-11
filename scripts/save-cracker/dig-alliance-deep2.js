// dig-alliance-deep2.js
// Trade-rights vs alliance pair (save_2.1 vs save_3.1) — alliance state SHOULD be on
// per-faction record. We already know per-faction records exist with region-list signatures
// (per session 31). Search SHORTER inserts (< 256 bytes) that look structurally
// "list-like" — e.g., a record that grew by 1 array entry.
//
// Even more targeted: look for byte patterns in B (alliance save) that contain
// faction 156 (Messapians) as a u32 byte sequence "9c 00 00 00" inserted INTO
// a context that previously had no such bytes. AND symmetrically, in B contain
// faction 0 (Romans) bytes "00 00 00 00" inserted.
//
// Messapians = idx 156 = 0x9c.
// Romans = idx 0.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

// Search for "9c000000" occurrences in B that have nothing similar at the
// corresponding pre-matrix position in A.

// Count occurrences of u32 = 156 (0x9c 00 00 00) and u32 = 0 in entire B.
function countPattern(buf, pat, start, end) {
  let count = 0;
  for (let i = start; i <= end - pat.length; i++) {
    let ok = true;
    for (let k = 0; k < pat.length; k++) if (buf[i+k] !== pat[k]) { ok = false; break; }
    if (ok) count++;
  }
  return count;
}

// "Alliance list" likely contains BOTH faction IDs (0=Romans, 156=Messapians)
// adjacent or in a structured record. Search B for sequences of 8 bytes where
// the u32 at +0 = 156 and u32 at +4 = some structured value (and vice versa).

console.log("=== Pattern hunt: 'alliance entry' structure ===");
console.log("Searching B for occurrences of 0x9c 00 00 00 (faction 156) and counts...");
const PRE = 0xf8000;  // search range pre-matrix
const cntA_156 = countPattern(A, Buffer.from([0x9c, 0, 0, 0]), 0, PRE);
const cntB_156 = countPattern(B, Buffer.from([0x9c, 0, 0, 0]), 0, PRE);
console.log(`In [0..0x${PRE.toString(16)}]: A has ${cntA_156} occurrences of (156 u32); B has ${cntB_156}`);

// Now look for inserted records SHORT in size (8-256 bytes) and CHARACTERISTIC.
// Re-run the shift diff but only print events with length 8-256 bytes that contain
// 0x9c 00 00 00 as a substring (or contain the romans index 0 in a way that suggests a faction-id list slot).

const events = [];
let i = 0, j = 0;
const maxShift = 4096;
while (i < A.length && j < B.length) {
  if (A[i] === B[j]) { i++; j++; continue; }
  let bestI = -1, bestJ = -1, bestRun = 0;
  for (let dj = 1; dj < maxShift && j + dj + 16 < B.length; dj++) {
    let run = 0;
    while (i + run < A.length && j + dj + run < B.length && A[i+run] === B[j+dj+run] && run < 256) run++;
    if (run >= 16 && run > bestRun) { bestI = i; bestJ = j+dj; bestRun = run; break; }
  }
  for (let di = 1; di < maxShift && i + di + 16 < A.length; di++) {
    let run = 0;
    while (i + di + run < A.length && j + run < B.length && A[i+di+run] === B[j+run] && run < 256) run++;
    if (run >= 16 && run > bestRun) { bestI = i+di; bestJ = j; bestRun = run; break; }
  }
  if (bestI < 0) { i++; j++; continue; }
  const skipA = bestI - i, skipB = bestJ - j;
  if (skipA === 0 && skipB > 0) {
    events.push({ kind: "INSERT", iA: i, jB: j, len: skipB, bytes: B.slice(j, j + skipB) });
  } else if (skipB === 0 && skipA > 0) {
    events.push({ kind: "DELETE", iA: i, jB: j, len: skipA, bytes: A.slice(i, i + skipA) });
  } else if (skipA > 0 && skipB > 0) {
    events.push({ kind: "REPLACE", iA: i, jB: j, lenA: skipA, lenB: skipB });
  }
  i = bestI; j = bestJ;
}

// Find small inserts (size <= 64 bytes) — small enough to be one alliance entry
function containsU32(buf, val) {
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === val) return i;
  }
  return -1;
}

const smallInserts = events.filter(e => e.kind === "INSERT" && e.len <= 96 && e.iA < 0xf8463d);
const smallInsContaining156 = smallInserts.filter(e => containsU32(e.bytes, 156) >= 0);
console.log(`\nSmall inserts (<=96 bytes) before matrix: ${smallInserts.length}`);
console.log(`...of which contain u32=156 (Messapians): ${smallInsContaining156.length}`);

console.log("\nSmall inserts containing u32=156 (potential alliance entries):");
for (const e of smallInsContaining156.slice(0, 30)) {
  const pos = containsU32(e.bytes, 156);
  console.log(`  [@A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}] +${e.len}B, 156-at-+${pos}: ${e.bytes.toString("hex")}`);
}

// Now ALSO check if there's a faction-record extension at the EXACT region known
// to contain major-faction records. Per session 31, major-faction records have
// region-list at "+52..+(52+4N)" and start around 0x103xxx. Romans Julii is idx 0,
// Messapians is idx 20 in major-faction order.

// Show changes in (0x60000, 0x90000) where major-faction records may live in this mod.
// Per session 31: major-faction records exist; per session 32 the matrix starts at 0xf8fd2,
// so the major-faction records must be BEFORE 0xf8fd2.

// Find faction record start signature: u32(+8)=100, u32(+12)=1, u32(+24)==(self), etc.
// Just look for "64 00 00 00 01 00 00 00" pattern as faction-record marker
const FACTION_MARKER = Buffer.from([0x64, 0, 0, 0, 0x01, 0, 0, 0]);
function findAll(buf, pat, start = 0, end = buf.length) {
  const out = [];
  for (let i = start; i <= end - pat.length; i++) {
    let ok = true;
    for (let k = 0; k < pat.length; k++) if (buf[i+k] !== pat[k]) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}

const facA = findAll(A, FACTION_MARKER, 0, 0x100000);
const facB = findAll(B, FACTION_MARKER, 0, 0x100000);
console.log(`\nFaction-record marker '64 00 00 00 01 00 00 00' occurrences:`);
console.log(`  A (save_2.1) in [0..0x100000]: ${facA.length}, first 5: ${facA.slice(0,5).map(o=>"0x"+o.toString(16)).join(", ")}`);
console.log(`  B (save_3.1) in [0..0x100000]: ${facB.length}, first 5: ${facB.slice(0,5).map(o=>"0x"+o.toString(16)).join(", ")}`);
