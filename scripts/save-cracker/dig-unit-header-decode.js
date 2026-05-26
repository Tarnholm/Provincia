// dig-unit-header-decode.js
// Precisely decode the variant-A unit container header fields and locate the
// per-soldier array start + stride. Map every u8/u16/u32 from the region
// terminator (ff ff ff ff) up to the first soldier record.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const recs = findUnitRecords(buf);

// Re-find the region terminator for a record (the parser stores offset+region).
function regionTermEnd(r) {
  // The parser sets regionEnd = re + 4 where re = end of region utf16. The
  // record object doesn't expose regionEnd, so re-derive from name+region.
  const nameEnd = r.offset + 2 + Buffer.from(r.name, 'ascii').length + 1; // +null
  // scan forward for region pstr like the parser does
  const ne = nameEnd - 1; // parser's `ne` is index of null terminator
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    let ok = true, nm = '';
    for (let j = rs; j < re; j += 2) {
      if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
      nm += String.fromCharCode(buf[j]);
    }
    if (!ok || nm !== r.region) continue;
    return re + 4; // skip the ff ff ff ff terminator
  }
  return null;
}

const samples = [
  recs.find(r => r.name === 'roman hastati early' && r.region === 'Etruria'),
  recs.find(r => r.name === 'roman equites early' && r.region === 'Etruria'),
  recs.find(r => r.name === 'roman triarii early' && r.region === 'Etruria'),
  recs.find(r => r.name === 'roman leves' && r.region === 'Etruria'),
];

for (const r of samples) {
  if (!r) continue;
  const te = regionTermEnd(r);
  if (te == null) { console.log('no term for', r.name); continue; }
  console.log('\n============================================================');
  console.log(`"${r.name}" sold=${r.soldiers}/${r.maxSoldiers}  termEnd@0x${te.toString(16)}`);
  console.log('============================================================');
  // Decode trailer as u32s for the first 40 dwords after terminator
  for (let i = 0; i < 40; i++) {
    const off = te + i * 4;
    const u32 = buf.readUInt32LE(off);
    const u16a = buf.readUInt16LE(off);
    const u16b = buf.readUInt16LE(off + 2);
    const bytes = Array.from(buf.slice(off, off + 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  +${(i*4).toString().padStart(3)} (0x${off.toString(16)}): ${bytes}  u32=${u32}  u16=[${u16a},${u16b}]`);
  }
  // Now locate the stat slots (01 00 40 00) and soldier array
  let firstSlot = -1;
  for (let off = te; off < te + 80; off++) {
    if (buf[off] === 0x01 && buf[off + 1] === 0x00 && buf[off + 2] === 0x40 && buf[off + 3] === 0x00) { firstSlot = off; break; }
  }
  console.log(`  --> first 01 00 40 00 slot @ +${firstSlot - te} (0x${firstSlot.toString(16)})`);
  // Count consecutive slots
  if (firstSlot > 0) {
    let n = 0, off = firstSlot;
    while (buf[off] === 0x01 && buf[off + 1] === 0x00 && buf[off + 2] === 0x40 && buf[off + 3] === 0x00) {
      console.log(`     slot${n} XX(+4)=${buf[off + 4]} (lvl ${Math.floor(buf[off+4]/4)})  raw14=${Array.from(buf.slice(off, off+14)).map(b=>b.toString(16).padStart(2,'0')).join('')}`);
      off += 14; n++;
      if (n > 8) break;
    }
    console.log(`     ${n} slots; bytes after last slot @ +${off - te}:`);
    console.log(`     ${Array.from(buf.slice(off, off + 24)).map(b=>b.toString(16).padStart(2,'0')).join(' ')}`);
  }
}
