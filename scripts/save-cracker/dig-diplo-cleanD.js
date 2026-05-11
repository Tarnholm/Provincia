// Session 32 step D: characterize the full 267-byte record.
// Each record has:
//   +0..+pad: zeros, then u32 ENUM, zeros, then sig (24 bytes), zeros, then u32=3, zeros, then u32=576, zeros, u32=166, ...
// The record start position is harder. Let's compute it precisely.
//
// hits[0] = 0xf8fde = sig start. So enum is at hits[0] - 8 (looking at 0x102f60-0x102f80 area):
//   At 0x102f65: 05 00 00 00 (enum)
//   At 0x102f70: 0a 00 00 00 (sig start)
//   Distance: 11 bytes? Actually 0x102f70 - 0x102f65 = 0xb = 11. But there's another u32=0 between.
// Actually re-look:
//   0x102f60 line: "00 00 00 00 00 05 00 00 00 00 00 00 00 00 00 00"
//   0x102f70 line: "00 0a 00 00 00 c8 00 00 00 c8 00 00 00 02 00 00"
// So at 0x102f65: u32 enum = 5 (bytes 05 00 00 00)
// At 0x102f70 byte 0 (offset 0x102f70): 00
// At 0x102f70 byte 1: 0a (sig starts here, at 0x102f71)
// Distance enum to sig: 0x102f71 - 0x102f65 = 0xc = 12 bytes.
// So sig is at +12 from enum.
//
// hits[0] = 0xf8fde -> enum at 0xf8fd2. record start = ?
//
// Let me find the record start by looking for the START of zero-runs preceding each record.
// Or simpler: assume record length = 267, find the first non-zero structural marker.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

// Compute record start by looking at internal markers.
// Per pattern: record looks like
//   [12-byte header? or zeros] [u32 enum] [zeros] [sig=24 bytes] [zeros] [u32=3] [zeros] [u32=576] [zeros] [u32=166] [trailing zeros]
// hits[0]=0xf8fde -> enum at 0xf8fd2 (sig-12).
// hits[1]=0xf90e9 -> enum at 0xf90dd.
// Difference 0xf90dd - 0xf8fd2 = 0x10b = 267. Good.
// So enum is at hits[i] - 12 for every i.
//
// Record start: a 267-byte record containing enum. If enum is at offset X within the record,
// record starts at hits[i] - 12 - X.
//
// Let's find boundary: look at structure 12 bytes BEFORE each enum.

console.log(`=== Bytes BEFORE enum (260 bytes before sig start) ===`);
const e0 = 0xf8fde - 12; // enum at 0xf8fd2
const e1 = 0xf90e9 - 12; // enum at 0xf90dd
console.log(`Enum 0 at 0x${e0.toString(16)}, enum 1 at 0x${e1.toString(16)}`);
// Show the FIRST bytes of a record. Look at all 267 bytes starting from e0 - K for various K.

// Find a clear record-start marker: many zeros surrounding then some structural marker.
// Print 267 bytes starting from e0 - 70:
function rec(off, len = 267) {
  return Array.from(a.slice(off, off + len)).map(x => x.toString(16).padStart(2, '0')).join(' ');
}

// Show every record at sig offset, working through all 267 bytes.
// Show all 267 bytes for record 0: e0-50 .. e0+217 (267 bytes).
// Actually compute differently: simply read 3 consecutive records and find a unique "start" byte.

for (let k = 0; k < 3; k++) {
  const enumOff = e0 + k * 267;
  // Show 267 bytes starting from enumOff - K for k=0
  const recStart = enumOff - 50; // arbitrary; will be refined
  console.log(`\n--- Record ${k}, showing 267 bytes from 0x${recStart.toString(16)} (enum at +50) ---`);
  for (let i = 0; i < 267; i += 16) {
    const slice = a.slice(recStart + i, recStart + i + 16);
    const off = recStart + i;
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log(`  ${off.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} ${ascii}`);
  }
}
