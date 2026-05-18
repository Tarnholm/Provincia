// Check if MP remaining (0-35) is encoded in the per-character byte at
// N+9, where N is the X-coord position. Session 4 found bit 7 of N+9 is
// the moved-this-turn flag. The remaining 7 bits might encode MP.
//
// For Macedon T0 (no one has moved yet), all characters should have
// MP=35 and moved-flag=0. Byte N+9 should be 0x23 (= 35 decimal).

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Find all character positions (same logic as main.js positions extraction)
const byteCounts = {};
const samples = [];
for (let N = 24; N < buf.length - 16; N++) {
  if (u32(N - 4) !== N - 4) continue;
  const type = u32(N - 12);
  if (type !== 6 && type !== 5 && type !== 4) continue;
  const x = u32(N);
  if (x < 0 || x > 1100) continue;
  const y = u32(N + 4);
  if (y < 0 || y > 800) continue;
  const uuid = u32(N - 8);
  if (!uuid) continue;
  const byte9 = buf[N + 9];
  byteCounts[byte9] = (byteCounts[byte9] || 0) + 1;
  if (samples.length < 30) samples.push({ N, uuid, x, y, type, byte9 });
}

console.log(`character positions found: ${Object.values(byteCounts).reduce((a, b) => a + b, 0)}`);
console.log("\nbyte9 value distribution (top 15):");
const sorted = Object.entries(byteCounts).sort((a, b) => b[1] - a[1]);
for (const [val, ct] of sorted.slice(0, 15)) {
  const v = parseInt(val);
  const mp = v & 0x7f;
  const moved = (v & 0x80) !== 0;
  console.log(`  byte9=0x${v.toString(16).padStart(2, "0")} (${v}): ${ct} chars  → MP=${mp} moved=${moved}`);
}

console.log("\nfirst 10 character samples:");
for (const s of samples.slice(0, 10)) {
  const mp = s.byte9 & 0x7f;
  const moved = (s.byte9 & 0x80) !== 0;
  console.log(`  N=0x${s.N.toString(16)} type=${s.type} uuid=${s.uuid.toString(16).padStart(8, "0")}  (${s.x},${s.y}) byte9=0x${s.byte9.toString(16).padStart(2, "0")} MP=${mp} moved=${moved}`);
}
