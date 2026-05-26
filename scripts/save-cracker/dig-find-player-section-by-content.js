// Find a section that contains BOTH the player banner AND at least 10
// antigonid char UUIDs. Reduces false positives from coincidental matches.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const BANNER = 0x150c1cc;
const chars = parseCharacterExtras(buf);
const antigonid = new Set(chars.filter(c => c.culture === "antigonid").map(c => c.ownUuid));
console.log(`looking for section containing banner + at least 10 of ${antigonid.size} antigonid UUIDs`);

// Build offset → near-uuid map for quick lookup
function countUuidsInRange(start, end) {
  const found = new Set();
  for (let p = start; p + 4 < end; p += 1) {
    const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0;
    if (antigonid.has(v)) found.add(v);
  }
  return found.size;
}

const candidates = [];
for (let p = 0; p + 8 < buf.length; p += 4) {
  if (buf.readUInt32LE(p) !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 100 * 1024 || size > 5 * 1024 * 1024) continue;
  const end = p + size;
  if (!(p <= BANNER && end > BANNER)) continue;
  candidates.push({ pos: p, size, end });
}
console.log(`${candidates.length} size-100KB-5MB candidates enclose banner`);

console.log("\nfor each candidate, count distinct antigonid UUIDs inside:");
candidates.sort((a, b) => a.size - b.size);
for (const c of candidates) {
  const uniq = countUuidsInRange(c.pos, c.end);
  console.log(`  0x${c.pos.toString(16).padStart(8, '0')}  size=${(c.size/1024).toFixed(1)}KB  antigonid_uuids=${uniq}`);
  if (uniq >= 10) {
    console.log(`    ^^ STRONG candidate ^^`);
  }
}

// Also try unique sizes (deduped by section start). If there's a unique
// smallest section enclosing banner with all 34 antigonids inside, that's
// the player faction record.
console.log("\nunique sections (best per size):");
const seenSizes = new Set();
const unique = [];
for (const c of candidates) {
  if (!seenSizes.has(c.size)) {
    seenSizes.add(c.size);
    unique.push(c);
  }
}
for (const c of unique.slice(0, 10)) {
  const uniq = countUuidsInRange(c.pos, c.end);
  console.log(`  0x${c.pos.toString(16).padStart(8, '0')}  size=${(c.size/1024).toFixed(1)}KB  uniq_antigonid=${uniq}`);
}
