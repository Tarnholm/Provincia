// Dump 512 bytes after postRegion of first antigonid char to look for
// trait structure manually.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const chars = parseCharacterExtras(buf);
const c = chars.find(x => x.culture === "antigonid");
const idx = c.offset;
const roleLen = (c.culture + " " + c.role + "\0").length;
const regionLen = c.region.length;
const postRegion = idx + roleLen + 23 + regionLen * 2;

console.log(`char @0x${idx.toString(16)} role="${c.culture} ${c.role}" age=${c.age} region="${c.region}"`);
console.log(`postRegion @0x${postRegion.toString(16)}\n`);

// Dump 512 bytes from postRegion onwards
for (let off = postRegion; off < postRegion + 512; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = buf[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  const relativeOff = off - idx;
  console.log(`  +${relativeOff.toString().padStart(3)} (0x${off.toString(16)}): ${hex.padEnd(48)} | ${asc}`);
}
