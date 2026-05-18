// Walk section type registry starting at ~0x3300 in vanilla save.
// Each entry: [u32 count][ASCIIZ name]. Find FACTION_ECONOMICS.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Try various starts. Find the first u32+ASCII pair pattern.
let regStart = -1;
for (let candidate = 0x3300; candidate < 0x3400; candidate += 4) {
  const count = u32(candidate);
  if (count < 1 || count > 100000) continue;
  // Check if bytes after are ASCII uppercase
  let nameLen = 0;
  while (candidate + 4 + nameLen < 0x4000) {
    const b = buf[candidate + 4 + nameLen];
    if (b === 0) break;
    if (b < 0x20 || b > 0x7e) { nameLen = -1; break; }
    nameLen++;
    if (nameLen > 100) { nameLen = -1; break; }
  }
  if (nameLen > 4) {
    regStart = candidate;
    break;
  }
}
if (regStart < 0) { console.log("no registry start found"); process.exit(0); }
console.log(`registry starts at 0x${regStart.toString(16)}`);

let off = regStart;
const entries = [];
while (entries.length < 200 && off < 0x10000) {
  if (off + 4 > buf.length) break;
  const count = u32(off);
  if (count > 100000) break;
  off += 4;
  let name = "";
  let nameOk = true;
  while (buf[off] !== 0 && off < 0x10000) {
    const b = buf[off];
    if (b < 0x20 || b > 0x7e) { nameOk = false; break; }
    name += String.fromCharCode(b);
    off++;
    if (name.length > 80) { nameOk = false; break; }
  }
  if (!nameOk || name.length === 0) break;
  off++; // skip null terminator
  entries.push({ id: entries.length, count, name });
}
console.log(`entries: ${entries.length}, ends at 0x${off.toString(16)}`);

// Find FACTION_ECONOMICS
const target = entries.find(e => /FACTION.*ECON/.test(e.name));
if (target) console.log(`\nFACTION_ECONOMICS: id=${target.id} count=${target.count}`);

// Print all
console.log("\nAll registry entries:");
for (const e of entries) {
  console.log(`  id=${e.id.toString().padStart(3)} count=${e.count.toString().padStart(5)} ${e.name}`);
}
