// Decode the inner layout of `+44=8` minor faction records.
// First 3 records had identical-ish bytes at the start. Look for what
// VARIES — that's the per-faction data.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const target = Buffer.from("captain_card_", "ascii");

// Find all minor records
const recs = [];
for (let i = 0; i + 200 < buf.length; i += 1) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 44) !== 8) continue;
  recs.push(i);
}

// For each, extract:
// - v0 (potential treasury)
// - banner faction from nearby captain_card_X.tga
// - v28 (UUID at +28)
// - v52 (might be regionCount-like value)
function readBanner(start, end) {
  const region = buf.slice(start, end);
  const idx = region.indexOf(target);
  if (idx === -1) return null;
  let e = idx + target.length;
  while (e < idx + 60 && region[e] !== 0x2e && region[e] >= 0x20 && region[e] < 0x7f) e++;
  return region.slice(idx + target.length, e).toString("ascii");
}

console.log(`${recs.length} minor records. First 30 entries:`);
console.log("idx | offset    | v0      | uuid@+28   | v52 | banner");
console.log("----|-----------|---------|------------|-----|--------");
for (let i = 0; i < Math.min(30, recs.length); i++) {
  const off = recs[i];
  const nextOff = i + 1 < recs.length ? recs[i + 1] : off + 50000;
  const v0 = buf.readInt32LE(off);
  const uuid = buf.readUInt32LE(off + 28);
  const v52 = buf.readUInt32LE(off + 52);
  const banner = readBanner(off, nextOff);
  console.log(`${i.toString().padStart(3)} | 0x${off.toString(16).padStart(7,'0')} | ${v0.toString().padStart(7)} | 0x${uuid.toString(16).padStart(8,'0')} | ${v52.toString().padStart(3)} | ${banner || "(none)"}`);
}

// Are any v0 values different? distribution of v0
console.log("\nv0 distribution (=treasury?):");
const v0counts = new Map();
for (const off of recs) {
  const v0 = buf.readInt32LE(off);
  v0counts.set(v0, (v0counts.get(v0) || 0) + 1);
}
for (const [v, c] of Array.from(v0counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  v0=${v.toString().padStart(7)}: ${c}x`);
}
