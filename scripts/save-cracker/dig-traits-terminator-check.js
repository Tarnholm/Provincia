// dig-traits-terminator-check.js
//
// Question: is the LAST trait slot a real trait or a terminator?
// The parser loops 0..traitCount-2 (drops last slot). The layout dump shows
// the last slot is a valid trait id with a sensible points value and the
// "data/" portrait prefix begins exactly +4 after the full tc*8 block.
//
// This script tests, across MANY characters and MULTIPLE saves:
//   - Is slot[tc-1] always a valid declared trait id? (=> not a terminator)
//   - Does the byte boundary (data/ prefix) sit at trait_block_end + small gap?
//   - What is the u16+6 field on the last slot vs interior slots?

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const MOD = "C:\\RIS\\RIS\\data";

const edctLines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
const traitNames = [];
for (const l of edctLines) { const m = l.match(/^Trait\s+(\S+)/); if (m) traitNames.push(m[1]); }
function loadNameLookup() {
  const buf = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"));
  const text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.toString("utf16le", 2) : buf.toString("utf8");
  return text.split(/\r?\n/).map(s => s.trim());
}
const nameLookup = loadNameLookup();
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");

const saves = process.argv.slice(2);
if (!saves.length) saves.push(path.join(SAVE_DIR, "save_macedon t0.sav"));

for (const sp of saves) {
  const buf = fs.readFileSync(sp);
  const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
  let lastValid = 0, lastInvalid = 0, total = 0;
  let interiorPad6nonZero = 0, lastPad6nonZero = 0;
  const lastPad6vals = [];
  for (const c of chars) {
    const layoutB = c.lastName == null;
    const tsOff = c.offset + (layoutB ? 304 : 308);
    const tcOff = c.offset + (layoutB ? 298 : 302);
    const tc = buf.readUInt16LE(tcOff);
    if (tc < 1 || tc > 200) continue;
    total++;
    // interior slots: check u16+6
    for (let i = 0; i < tc - 1; i++) {
      if (buf.readUInt16LE(tsOff + i * 8 + 6) !== 0) interiorPad6nonZero++;
    }
    // last slot
    const lastBase = tsOff + (tc - 1) * 8;
    const lastTid = buf.readUInt32LE(lastBase);
    const lastPad6 = buf.readUInt16LE(lastBase + 6);
    if (lastTid < traitNames.length && traitNames[lastTid]) lastValid++; else lastInvalid++;
    if (lastPad6 !== 0) { lastPad6nonZero++; lastPad6vals.push(lastPad6); }
  }
  console.log(`\n=== ${path.basename(sp)} (${chars.length} chars, ${total} with traits) ===`);
  console.log(`  last-slot is a VALID declared trait id:  ${lastValid}/${total}  (invalid ${lastInvalid})`);
  console.log(`  interior slots with nonzero u16+6:       ${interiorPad6nonZero}`);
  console.log(`  last slots with nonzero u16+6:           ${lastPad6nonZero}/${total}`);
  if (lastPad6vals.length) {
    const samp = lastPad6vals.slice(0, 12).join(", ");
    console.log(`  sample last-slot u16+6 values:           ${samp}`);
  }
}
