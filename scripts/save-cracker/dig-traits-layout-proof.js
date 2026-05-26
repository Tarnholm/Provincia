// dig-traits-layout-proof.js
//
// Drill into the exact per-trait record layout: 8-byte stride, what the two
// u16 fields after the u32 id hold, and whether the trait list has a
// terminator slot. Also dumps the bytes AFTER the trait block to see the
// boundary (ancillaries / portrait length prefix).
//
// Usage: node dig-traits-layout-proof.js [savePath] [charNameSubstr]

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const savePath = process.argv[2] || path.join(SAVE_DIR, "save_macedon t0.sav");
const nameFilter = process.argv[3] || null;
const MOD = "C:\\RIS\\RIS\\data";

const edctLines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
const traitNames = [];
for (const l of edctLines) { const m = l.match(/^Trait\s+(\S+)/); if (m) traitNames.push(m[1]); }

function loadNameLookup() {
  const p = path.join(MOD, "descr_names_lookup.txt");
  const buf = fs.readFileSync(p);
  const text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.toString("utf16le", 2) : buf.toString("utf8");
  return text.split(/\r?\n/).map(s => s.trim());
}
const nameLookup = loadNameLookup();
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");
const buf = fs.readFileSync(savePath);
const chars = findCharacterRecords(buf, nameLookup, traitNames, null);

console.log(`${path.basename(savePath)}: ${chars.length} chars\n`);

// Pick a leader with many traits (or filter by name)
let target = null;
if (nameFilter) {
  target = chars.find(c => (`${c.firstName} ${c.lastName||""}`).toLowerCase().includes(nameFilter.toLowerCase()) && c.traits.length > 5);
}
if (!target) target = chars.filter(c => c.isLeader).sort((a, b) => b.traits.length - a.traits.length)[0];

const c = target;
const layoutB = c.lastName == null;
const tcOff = c.offset + (layoutB ? 298 : 302);
const tsOff = c.offset + (layoutB ? 304 : 308);
const tc = buf.readUInt16LE(tcOff);
console.log(`Target: ${c.firstName} ${c.lastName||""} @0x${c.offset.toString(16)} layout${layoutB?"B":"A"}`);
console.log(`traitCount(u16 @+${layoutB?298:302}) = ${tc}`);
console.log(`Dump of ALL ${tc} 8-byte slots from +${layoutB?304:308}:`);
for (let i = 0; i < tc; i++) {
  const base = tsOff + i * 8;
  const tid = buf.readUInt32LE(base);
  const a = buf.readUInt16LE(base + 4);
  const b = buf.readUInt16LE(base + 6);
  const hex = buf.slice(base, base + 8).toString("hex");
  const nm = traitNames[tid] || "??";
  console.log(`  slot[${String(i).padStart(2)}] @0x${base.toString(16)} ${hex}  tid=${String(tid).padStart(4)} u16+4=${String(a).padStart(5)} u16+6=${String(b).padStart(5)}  ${nm}`);
}
// Show 24 bytes AFTER the last slot to inspect terminator/ancillary/portrait boundary
const afterStart = tsOff + tc * 8;
console.log(`\nBytes immediately AFTER slot[${tc-1}] (offset 0x${afterStart.toString(16)}), next 32 bytes:`);
console.log("  " + buf.slice(afterStart, afterStart + 32).toString("hex").replace(/(..)/g, "$1 "));
// Also try interpreting "data/" search
let dataPos = -1;
for (let i = 0; i < 64 && afterStart + i + 5 < buf.length; i++) {
  if (buf.slice(afterStart + i, afterStart + i + 5).toString("ascii") === "data/") { dataPos = i; break; }
}
console.log(`  "data/" portrait prefix found at +${dataPos} after trait block`);

// Now: is the last slot a real trait or a terminator? Check whether the
// parser's "traitCount-1" loop drops a real trait.
console.log(`\nLast slot tid=${buf.readUInt32LE(tsOff + (tc-1)*8)} (${traitNames[buf.readUInt32LE(tsOff + (tc-1)*8)]||"??"})`);
console.log(`Parser currently iterates 0..${tc-2} (drops last slot as 'terminator').`);
