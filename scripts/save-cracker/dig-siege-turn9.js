// dig-siege-turn9.js
// Decompose the besieger-side 4-byte insertion:
//   save_6 → save_7: 4-byte INSERT at 0x1263385 = "a7c19005"
//   save_8 → save_9: 4-byte DELETE at 0x12d8724 = "93a67b05"
//
// Session 33 said this was the "01 + 4-byte UUID prefix" 5-byte back-reference.
// But actually: in save_6 (pre-siege) at 0x1263384, what was there? And what was at +4?

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const saves = ["save_6.1.sav", "save_7.1.sav", "save_8.1.sav", "save_9.1.sav"];

// Each save's "back-reference offset" might shift due to the insert. Let's check
// the relevant region in each save.

const buffers = {};
for (const s of saves) {
  buffers[s] = fs.readFileSync(path.join(SAVE_DIR, s));
}

// Per the diff, in save_6 the 4-byte insertion was at 0x1263385. So in save_6 the byte
// at 0x1263385 is "where the insert happens". Let me look at 32 bytes around it in each save.

console.log("=== Bytes [0x1263370..0x12633b0] in each save ===");
for (const s of saves) {
  const buf = buffers[s];
  console.log(`\n${s}:`);
  for (let off = 0x1263370; off < 0x12633b0; off += 8) {
    console.log(`  0x${off.toString(16)}: ${buf.slice(off, off+8).toString("hex")}`);
  }
}

// save_7's UUID prefix is 8ca7c190 — and inserted bytes were "a7c19005" at 0x1263385.
// So the insert is "a7c19005" (not "8ca7c190" — different!).
// Wait — let me check what bytes around 0x1263385 in save_7 look like.

console.log("\n=== save_7 bytes [0x1263380..0x12633a0] (4-byte insert was at 0x1263385) ===");
const s7 = buffers["save_7.1.sav"];
console.log(`  0x1263380..0x126338c: ${s7.slice(0x1263380, 0x126338c).toString("hex")}`);

// Decode interesting bytes: u8 at 0x1263384, then 4-byte inserted "a7c19005" starting 0x1263385.
// But UUID prefix is "8c a7 c1 90". So:
// At 0x1263384: 0x01 (the "active siege" flag — corresponds to session 33's "01")
// At 0x1263385..0x1263388: "8c a7 c1 90" (the 4-byte UUID prefix)
// Wait the insertion was "a7c19005" — that's bytes 8c a7 c1 90 SHIFTED to start at 0x1263385,
// with 0x8c displaced to ... hmm. Let me look at exact pre/post-insertion bytes in save_6 and save_7.

console.log("\n=== Pre-insertion (save_6) and post-insertion (save_7) at the insert site ===");
const s6 = buffers["save_6.1.sav"];
console.log(`save_6 0x1263380..0x12633a0: ${s6.slice(0x1263380, 0x12633a0).toString("hex")}`);
console.log(`save_7 0x1263380..0x12633a0: ${s7.slice(0x1263380, 0x12633a0).toString("hex")}`);

// Where was the byte "0x01" inserted? Let me find the 5-byte sequence
// "01 + 4byte-prefix" in save_7 around this area.
const targetUuidPrefix = Buffer.from("8ca7c190", "hex");
function findPattern(buf, start, end, pat) {
  const out = [];
  for (let i = start; i + pat.length <= end; i++) {
    let ok = true;
    for (let k = 0; k < pat.length; k++) if (buf[i + k] !== pat[k]) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}
const found7 = findPattern(s7, 0x1260000, 0x1270000, targetUuidPrefix);
const found6 = findPattern(s6, 0x1260000, 0x1270000, targetUuidPrefix);
console.log(`\nUUID prefix '8c a7 c1 90' in save_7 [0x1260000..0x1270000]: ${found7.map(o => "0x"+o.toString(16)).join(", ")}`);
console.log(`Same in save_6: ${found6.map(o => "0x"+o.toString(16)).join(", ")}`);
