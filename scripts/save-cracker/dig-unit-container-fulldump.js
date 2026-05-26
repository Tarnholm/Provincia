// dig-unit-container-fulldump.js
// Dump the FULL byte span of one unit container (string record -> next record)
// to map: name pstr -> hash/seed/count -> region pstr -> variant-A trailer ->
// stat slots (01 00 40 00 XX) -> per-soldier 9-byte array -> 0xff terminator.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const recs = findUnitRecords(buf);

// Pick the first hastati in Etruria and the equites (different size unit).
const targetNames = ['roman hastati early', 'roman equites early'];
for (const tn of targetNames) {
  const idx = recs.findIndex(r => r.name === tn && r.region === 'Etruria');
  if (idx < 0) { console.log('not found:', tn); continue; }
  const r = recs[idx];
  const next = recs[idx + 1] ? recs[idx + 1].offset : r.offset + 2000;
  const span = next - r.offset;
  console.log('\n############################################################');
  console.log(`"${r.name}" @0x${r.offset.toString(16)} sold=${r.soldiers}/${r.maxSoldiers}  next@0x${next.toString(16)}  span=${span} bytes`);
  console.log('############################################################');
  // Dump in 16-byte rows with record-relative offset annotation
  for (let off = r.offset; off < next; off += 16) {
    const rel = off - r.offset;
    const n = Math.min(16, next - off);
    const hex = Array.from(buf.slice(off, off + n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(buf.slice(off, off + n)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log(`+${rel.toString().padStart(4)} 0x${off.toString(16)}: ${hex.padEnd(48)} |${ascii}|`);
  }
}
