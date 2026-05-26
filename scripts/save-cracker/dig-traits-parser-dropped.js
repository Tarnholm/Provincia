// dig-traits-parser-dropped.js
//
// Quantify the parser bug: characterParser.js loops `i < traitCount - 1`,
// treating the last slot as a "terminator". But the terminator-check proved
// the last slot is ALWAYS a real trait (100% valid id). So the parser drops
// exactly ONE real trait per character. This script lists which traits get
// dropped and how often, on the ground-truth save.
//
// Usage: node dig-traits-parser-dropped.js [savePath]

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const MOD = "C:\\RIS\\RIS\\data";
const savePath = process.argv[2] || path.join(SAVE_DIR, "save_macedon t0.sav");

const edctLines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
const traitNames = [];
for (const l of edctLines) { const m = l.match(/^Trait\s+(\S+)/); if (m) traitNames.push(m[1]); }
function loadNameLookup() {
  const b = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"));
  const t = (b[0] === 0xff && b[1] === 0xfe) ? b.toString("utf16le", 2) : b.toString("utf8");
  return t.split(/\r?\n/).map(s => s.trim());
}
const nameLookup = loadNameLookup();
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");
const buf = fs.readFileSync(savePath);
const chars = findCharacterRecords(buf, nameLookup, traitNames, null);

const droppedFreq = new Map();
let dropped = 0;
for (const c of chars) {
  const layoutB = c.lastName == null;
  const tsOff = c.offset + (layoutB ? 304 : 308);
  const tc = buf.readUInt16LE(c.offset + (layoutB ? 298 : 302));
  if (tc < 1) continue;
  // The trait the parser DROPS is slot[tc-1].
  const tid = buf.readUInt32LE(tsOff + (tc - 1) * 8);
  const nm = traitNames[tid];
  if (nm) { dropped++; droppedFreq.set(nm, (droppedFreq.get(nm) || 0) + 1); }
}
console.log(`${path.basename(savePath)}: parser drops the last trait of ${dropped} characters.\n`);
console.log("Most-frequently DROPPED traits (these are real, lost by the i<tc-1 loop):");
for (const [n, f] of Array.from(droppedFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(f).padStart(4)}  ${n}`);
}

// Compare parser-reported count vs full count for the trait-rich generals.
console.log("\nPer-character: parser-reported traitCount vs actual:");
const rich = chars.filter(c => c.traits.length > 6).slice(0, 6);
for (const c of rich) {
  const layoutB = c.lastName == null;
  const tc = buf.readUInt16LE(c.offset + (layoutB ? 298 : 302));
  console.log(`  ${(c.firstName+" "+(c.lastName||"")).padEnd(28)} parser=${c.traits.length}  actual=${tc}  (dropped: ${traitNames[buf.readUInt32LE(c.offset+(layoutB?304:308)+(tc-1)*8)]})`);
}
