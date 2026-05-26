// Search a wide window around the antigonid char record for a trait list.
// Look for u16 count + count*8 valid trait entries.
const fs = require("fs");
const path = require("path");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

// Load trait names from RIS
const traitsTxt = fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_character_traits.txt", "utf8");
const traitNames = ["__nontrait__"]; // index 0 is the "no trait" sentinel
const lines = traitsTxt.split(/\r?\n/);
for (const line of lines) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}
console.log(`mod has ${traitNames.length - 1} trait names\n`);

const chars = parseCharacterExtras(buf);
const c = chars.find(x => x.culture === "antigonid");
const idx = c.offset;

console.log(`searching for trait list around char @0x${idx.toString(16)}`);

// Scan +50 to +2000 for u16 count + count*8 valid trait entries
for (let off = 50; off < 2000; off += 1) {
  const tcOff = idx + off;
  if (tcOff + 2 > buf.length) break;
  const tc = buf.readUInt16LE(tcOff);
  if (tc < 2 || tc > 40) continue;
  // Try to validate count*8 trait entries follow
  let validEntries = 0;
  for (let i = 0; i < tc; i++) {
    const tOff = tcOff + 2 + i * 8;
    if (tOff + 8 > buf.length) break;
    const tid = buf.readUInt32LE(tOff);
    const level = buf.readUInt16LE(tOff + 4);
    const pad = buf.readUInt16LE(tOff + 6);
    if (tid < traitNames.length && tid > 0 && level >= 1 && level <= 8 && pad <= 5) {
      validEntries++;
    }
  }
  if (validEntries === tc && tc >= 3) {
    // STRONG candidate
    console.log(`FOUND: u16 count=${tc} at idx+${off} (0x${tcOff.toString(16)}), ${validEntries}/${tc} valid entries`);
    for (let i = 0; i < tc; i++) {
      const tOff = tcOff + 2 + i * 8;
      const tid = buf.readUInt32LE(tOff);
      const level = buf.readUInt16LE(tOff + 4);
      const name = tid < traitNames.length ? traitNames[tid] : "?";
      console.log(`  [${i}] tid=${tid} level=${level} = ${name}`);
    }
    break; // Found the first hit, that's enough
  }
}
