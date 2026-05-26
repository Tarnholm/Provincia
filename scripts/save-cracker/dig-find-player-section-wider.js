// Find ANY taw section enclosing the antigonid banner, no size limit
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const BANNER = 0x150c1cc;
console.log(`looking for ANY section enclosing 0x${BANNER.toString(16)}, sized 1KB-30MB`);

const candidates = [];
for (let p = 0; p + 8 < buf.length; p += 4) {
  if (buf.readUInt32LE(p) !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 1024 || size > 30 * 1024 * 1024) continue;
  const end = p + size;
  if (p <= BANNER && end > BANNER) {
    candidates.push({ pos: p, size, end });
  }
}
console.log(`${candidates.length} candidates`);
candidates.sort((a, b) => a.size - b.size);
for (const c of candidates.slice(0, 25)) {
  console.log(`  0x${c.pos.toString(16).padStart(8, '0')}  size=${(c.size/1024).toFixed(1).padStart(10)}KB  end=0x${c.end.toString(16)}  delta=${(BANNER - c.pos).toLocaleString()}`);
}
