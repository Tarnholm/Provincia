// Section type registry per cracker memory: at 0x500-0xde0, format
// `[u32 count][ASCIIZ name]` per entry. 106 types. FACTION_ECONOMICS is
// ID 91 (count 36 entries = one per faction).
//
// Walk the registry, dump entries, find FACTION_ECONOMICS, then look for
// the corresponding data section.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Walk from 0x500: each entry is [u32 count][ASCIIZ name].
// Stop when we hit non-ASCII or run past 0xde0.
let off = 0x500;
const entries = [];
let id = 0;
while (off < 0xfff && entries.length < 200) {
  if (off + 4 >= buf.length) break;
  const count = u32(off);
  // Sanity check: counts shouldn't be huge
  if (count > 100000) break;
  off += 4;
  // Read ASCIIZ name
  let name = "";
  let nameOk = true;
  while (off < 0x1000 && buf[off] !== 0) {
    const b = buf[off];
    if (b < 0x20 || b > 0x7e) { nameOk = false; break; }
    name += String.fromCharCode(b);
    off++;
  }
  if (!nameOk || name.length < 2 || name.length > 100) break;
  off++; // skip null
  entries.push({ id, count, name });
  id++;
}
console.log(`registry entries parsed: ${entries.length}`);
console.log(`registry end offset: 0x${off.toString(16)}`);

// Find FACTION_ECONOMICS specifically
const target = entries.find(e => /faction_econ/i.test(e.name) || /economics/i.test(e.name));
if (target) console.log(`\nFACTION_ECONOMICS found: id=${target.id} count=${target.count} name="${target.name}"`);

// Look for "faction" related entries
console.log("\nentries with 'faction' or related:");
for (const e of entries) {
  if (/faction|treasur|econom|money/i.test(e.name)) {
    console.log(`  id=${e.id.toString().padStart(3)} count=${e.count.toString().padStart(5)} name=${e.name}`);
  }
}

// Dump the first 30 entries
console.log("\nfirst 30 registry entries:");
for (const e of entries.slice(0, 30)) {
  console.log(`  id=${e.id.toString().padStart(3)} count=${e.count.toString().padStart(5)} name=${e.name}`);
}
