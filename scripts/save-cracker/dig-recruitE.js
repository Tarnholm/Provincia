// Decode the queue region structure exactly.
// Anchors:
//   default_set (12 chars) ends at offset 0xf84653
//   then [5a 46 f8 00] = u32 self-pointer (= 0xf8465a... actually points to next entry)
//   then [u32 hash] [fc fc fc fc magic]
//   then a record body (variable length)
//   then [0c 00 00 00 XX 46 f8 00] = size-12 next-pointer to hinterland_region entry start
//
// In save_1.2 (no queue), the record body is 26 bytes
// In save_2.2 (wall queue), the record body is 26 + 18 = 44 bytes (extra 18 bytes for queue entry)
// In save_3.2 (levies queue), the record body is 26 + 0 bytes (no extra) but uses inline data
//
// Wait — save_3.2 has -18 bytes vs save_2.2 but ALSO has the queue. So actually it
// must be: the BASE record is X bytes, save_2.2 adds 18+(18-y) for wall, save_3.2 adds y for levies.
//
// Let me find the size of this whole record by reading the [0c 00 00 00] preamble of the
// hinterland_region entry that comes after.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_1.2.sav', 'save_2.2.sav', 'save_3.2.sav', 'save_4.2.sav'];
const bufs = files.map(f => fs.readFileSync(path.join(SAVE_DIR, f)));

// In each save, find the offset where "hinterland_region" appears within this Roma block
function findHR(buf, from, to) {
  return buf.indexOf(Buffer.from('hinterland_region'), from, 'latin1');
}

console.log('Comparing Roma\'s pre-hinterland_region region across saves:\n');

for (let i = 0; i < bufs.length; i++) {
  const b = bufs[i];
  // start: default_set anchor
  const dsIdx = b.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1');
  const hrIdx = b.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1');
  console.log(`${files[i]}:`);
  console.log(`  default_set at 0x${dsIdx.toString(16)}`);
  console.log(`  hinterland_region at 0x${hrIdx.toString(16)} (offset from default_set+12 = ${hrIdx - dsIdx - 12} bytes)`);
  // The next-link u32 before hinterland_region: at hrIdx-2 we have [u16 nameLen]
  // and at hrIdx-10 we have [u32 size 0x0c][u32 ptr]
  if (hrIdx > 0) {
    const ptr = b.readUInt32LE(hrIdx - 6);
    const nameLen = b.readUInt16LE(hrIdx - 2);
    const sizeF = b.readUInt32LE(hrIdx - 10);
    console.log(`  size_before_hr = 0x${sizeF.toString(16)} (${sizeF}); ptr_before_hr = 0x${ptr.toString(16)}; nameLen = ${nameLen}`);
  }
}

// Show, more aligned, the bytes from "default_set\0" end up to "hinterland_region" start
for (let i = 0; i < bufs.length; i++) {
  const b = bufs[i];
  const dsIdx = b.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1');
  const hrIdx = b.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1');
  // The region between default_set and hinterland_region: from dsIdx+12 to hrIdx-2
  // (where -2 is the start of the [u16 nameLen] for "hinterland_region")
  const regStart = dsIdx + 12;
  const regEnd = hrIdx - 10;  // before [u32 size][u32 ptr][u16 nameLen]
  console.log(`\n=== ${files[i]} between default_set and hinterland_region size-field ===`);
  console.log(`  range 0x${regStart.toString(16)} .. 0x${regEnd.toString(16)} = ${regEnd-regStart} bytes`);
  const slice = b.slice(regStart, regEnd);
  // hex 16 per line
  for (let p = 0; p < slice.length; p += 16) {
    const line = slice.slice(p, p+16);
    const hex = Array.from(line).map(x => x.toString(16).padStart(2,'0')).join(' ');
    const asc = Array.from(line).map(x => (x>=0x20 && x<0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log(`    0x${(regStart+p).toString(16).padStart(8,'0')}: ${hex.padEnd(48)} | ${asc}`);
  }
}
