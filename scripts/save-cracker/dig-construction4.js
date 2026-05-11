#!/usr/bin/env node
// Probe Alexander/Macedon save structure — look for cb 00 00 00 markers, settlement names,
// and basic file structure.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const buf = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));

console.log(`File size: ${buf.length}`);
console.log(`Magic: 0x${buf.readUInt16LE(0).toString(16)}`);

// Count cb 00 00 00 hits
let cbCount = 0;
for (let i = 0; i + 4 < buf.length; i++) {
  if (buf[i] === 0xcb && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 0) {
    cbCount++;
  }
}
console.log(`cb 00 00 00 hits: ${cbCount}`);

// Look for known settlement names in UTF-16LE (Pella, Edessa, Beroea, Athens, Sparta — Macedonian capitals)
const candidateNames = ['Pella', 'Edessa', 'Beroea', 'Olympia', 'Athens', 'Sparta', 'Thebes', 'Demetrias', 'Pydna', 'Larissa', 'Pherae'];
for (const name of candidateNames) {
  const utf16 = Buffer.from(name, 'utf16le');
  let pos = 0;
  let hits = [];
  while ((pos = buf.indexOf(utf16, pos)) !== -1) {
    hits.push(pos);
    pos += 1;
  }
  console.log(`"${name}" UTF-16LE: ${hits.length} hits, first: ${hits.slice(0, 5).map(p => '0x' + p.toString(16)).join(',')}`);
}

// Also try without "Macedon" hits in cstring
const cstrings = ['macedon', 'romans_julii', 'imperial_campaign', 'alexander', 'pella'];
for (const name of cstrings) {
  let pos = 0;
  const utf8 = Buffer.from(name + '\0');
  let hits = [];
  while ((pos = buf.indexOf(utf8, pos)) !== -1) {
    hits.push(pos);
    pos += 1;
  }
  console.log(`"${name}" cstr: ${hits.length} hits, first: ${hits.slice(0, 3).map(p => '0x' + p.toString(16)).join(',')}`);
}

// Check campaign name at start of header
console.log(`\nFirst 64 bytes:`);
for (let i = 0; i < 64; i += 16) {
  let hex = '';
  for (let j = 0; j < 16 && i+j < 64; j++) {
    hex += buf[i+j].toString(16).padStart(2, '0') + ' ';
  }
  console.log(`  0x${i.toString(16).padStart(4,'0')}: ${hex}`);
}

// look for utf-16 strings in 0x3a onwards
console.log(`\nLooking for campaign name (UTF-16LE) at typical offsets:`);
for (let off of [0x3a, 0x36, 0x4a]) {
  const len = buf.readUInt16LE(off);
  if (len > 0 && len < 100) {
    const s = buf.slice(off + 2, off + 2 + len * 2).toString('utf16le');
    if (/^[\x20-\x7e]+$/.test(s)) {
      console.log(`  @0x${off.toString(16)}: len=${len} "${s}"`);
    }
  }
}
