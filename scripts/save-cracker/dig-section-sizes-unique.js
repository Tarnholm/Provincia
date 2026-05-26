// Distribution of enclosing-section SIZES.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const ROSTER = 0x1517fe3;

const sizeMap = new Map();
let total = 0;
for (let p = 0; p + 8 < buf.length; p += 4) {
  if (buf.readUInt32LE(p) !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 100 || size > 50 * 1024 * 1024) continue;
  const end = p + size;
  if (p < ROSTER && end > ROSTER) {
    sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
    total += 1;
  }
}
console.log(`${total} enclosing sections; unique sizes: ${sizeMap.size}`);
const sorted = Array.from(sizeMap.entries()).sort((a, b) => a[0] - b[0]);
for (const [size, count] of sorted) {
  console.log(`  size=${size.toLocaleString().padStart(14)} (${(size/1024).toFixed(1)} KB)  ${count}x`);
}

// Specifically, look for sections sized in [200KB, 500KB] (player record est. 334KB)
console.log("\n--- candidates with size in 200KB-500KB range ---");
let count = 0;
for (let p = 0; p + 8 < buf.length && count < 30; p += 4) {
  if (buf.readUInt32LE(p) !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 200 * 1024 || size > 500 * 1024) continue;
  const end = p + size;
  if (p < ROSTER && end > ROSTER) {
    console.log(`  0x${p.toString(16).padStart(8,'0')}  size=${size.toLocaleString()} (${(size/1024).toFixed(1)} KB) ends 0x${end.toString(16)}`);
    count++;
  }
}
