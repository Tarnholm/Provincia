// Find Areus's record in save_1.7. He was settlement-resident in save_1.6 and
// moved to (403, 332) in save_1.7. Apply the confirmed character record
// pattern: u32le X, u32le Y at +4 bytes.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const v16 = fs.readFileSync(path.join(SAVE_DIR, "save_1.6.sav"));
const v17 = fs.readFileSync(path.join(SAVE_DIR, "save_1.7.sav"));

console.log(`v1.6: ${v16.length.toLocaleString()}, v1.7: ${v17.length.toLocaleString()}, Δ=${v17.length - v16.length}\n`);

// Find every u32le offset where X=403 AND u32le at +4 = 332
const X = 403, Y = 332;
const candidatesV17 = [];
for (let i = 0; i + 8 <= v17.length; i++) {
  if (v17.readUInt32LE(i) === X && v17.readUInt32LE(i + 4) === Y) {
    candidatesV17.push(i);
  }
}
console.log(`save_1.7: ${candidatesV17.length} positions where u32(X)=${X} AND u32(X+4)=${Y}`);
for (const off of candidatesV17.slice(0, 20)) {
  console.log(`  @0x${off.toString(16).padStart(8,"0")}`);
}

// Validation: also check Leonidas's known position (407, 320) is at the same offset
// across both v1.6 and v1.7 (since Leonidas didn't move between them).
const LEONIDAS_OFF = 0x154a708;
console.log(`\nLeonidas validation @0x${LEONIDAS_OFF.toString(16)}:`);
console.log(`  v1.6: X=${v16.readUInt32LE(LEONIDAS_OFF)}, Y=${v16.readUInt32LE(LEONIDAS_OFF + 4)}`);
console.log(`  v1.7: X=${v17.readUInt32LE(LEONIDAS_OFF)}, Y=${v17.readUInt32LE(LEONIDAS_OFF + 4)}`);

// Now: for each candidate Areus position in save_1.7, dump bytes around it
const PRE = 32, POST = 32;
for (const off of candidatesV17.slice(0, 5)) {
  console.log(`\n=== Areus candidate @0x${off.toString(16)} in save_1.7 ===`);
  for (let row = -PRE; row < POST; row += 16) {
    const o = off + row;
    if (o < 0 || o + 16 > v17.length) continue;
    const bytes = Array.from(v17.subarray(o, o + 16)).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(v17.subarray(o, o + 16)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    let line = `Δ${String(row).padStart(4)}  0x${o.toString(16).padStart(8,"0")}  ${bytes}  ${ascii}`;
    if (row === 0) line += "  ← X";
    if (row === 4) line += "  ← Y";
    console.log(line);
  }
  // Compare with same offset in v1.6 (where Areus would've been settlement-resident)
  console.log(`-- Same offset in v1.6 (where Areus was IN Sparta city):`);
  for (let row = -16; row < 32; row += 16) {
    const o = off + row;
    if (o < 0 || o + 16 > v16.length) continue;
    const bytes = Array.from(v16.subarray(o, o + 16)).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(v16.subarray(o, o + 16)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`Δ${String(row).padStart(4)}  ${bytes}  ${ascii}`);
  }
}

// Distance from Leonidas's record to each Areus candidate
console.log(`\n=== Distance from Leonidas record (0x${LEONIDAS_OFF.toString(16)}) to each Areus candidate ===`);
for (const off of candidatesV17) {
  console.log(`  Δ from Leonidas: ${off - LEONIDAS_OFF} bytes (${off > LEONIDAS_OFF ? "after" : "before"})`);
}
