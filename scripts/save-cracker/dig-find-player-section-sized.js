// Find a TAW section {ptr=pos, size} where size is reasonable for a
// player faction record (~100KB-2MB) AND encloses the antigonid banner
// at 0x150c1cc.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const BANNER = 0x150c1cc;
console.log(`looking for section enclosing banner at 0x${BANNER.toString(16)} with size 100KB-2MB`);

const candidates = [];
for (let p = 0; p + 8 < buf.length; p += 1) {
  if (buf.readUInt32LE(p) !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 50 * 1024 || size > 2 * 1024 * 1024) continue;
  const end = p + size;
  if (p <= BANNER && end > BANNER) {
    candidates.push({ pos: p, size, end });
  }
}
console.log(`${candidates.length} candidates`);
// Sort by size ascending (smallest = tightest enclosing section)
candidates.sort((a, b) => a.size - b.size);
for (const c of candidates.slice(0, 20)) {
  console.log(`  0x${c.pos.toString(16).padStart(8, '0')}  size=${(c.size/1024).toFixed(1)}KB  end=0x${c.end.toString(16)} delta_from_banner=${(BANNER - c.pos).toLocaleString()}`);
}

// Also enclose checking for size + 8 (= section data + 8 header)
console.log("\n--- with header (size + 8) enclosing banner ---");
const c2 = [];
for (let p = 0; p + 8 < buf.length; p += 1) {
  if (buf.readUInt32LE(p) !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 50 * 1024 || size > 2 * 1024 * 1024) continue;
  const end = p + size + 8;
  if (p <= BANNER && end > BANNER) {
    c2.push({ pos: p, size, end });
  }
}
console.log(`${c2.length} candidates`);
c2.sort((a, b) => a.size - b.size);
for (const c of c2.slice(0, 10)) {
  console.log(`  0x${c.pos.toString(16).padStart(8, '0')}  size=${(c.size/1024).toFixed(1)}KB`);
}
