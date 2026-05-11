#!/usr/bin/env node
// Hex-dump the relevant Pella region for BOTH saves side by side, anchored to "core_building"
// at the end. Then identify what 53 bytes B has that A doesn't.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

const aPella = A.indexOf(Buffer.from('Pella', 'utf16le'));
const bPella = B.indexOf(Buffer.from('Pella', 'utf16le'));
const aCb = A.indexOf(Buffer.from('core_building\0'), aPella);
const bCb = B.indexOf(Buffer.from('core_building\0'), bPella);

// Anchor on core_building (use cb-6 = nameLen u16 prefix as start of sub-record header)
const aCbHdr = aCb - 6; // [u32 self-ptr][u16 nameLen]
const bCbHdr = bCb - 6;

console.log('=== A from Pella+0 to core_building header (aligned by tail) ===');
console.log(`A: Pella@${aPella}, cb hdr@${aCbHdr}, span = ${aCbHdr - aPella}`);
console.log(`B: Pella@${bPella}, cb hdr@${bCbHdr}, span = ${bCbHdr - bPella}`);
console.log(`B - A span = ${(bCbHdr - bPella) - (aCbHdr - aPella)} bytes`);

const aBytes = A.slice(aPella, aCbHdr);
const bBytes = B.slice(bPella, bCbHdr);

console.log(`\nA Pella..cb_hdr (${aBytes.length} bytes):`);
hexdumpAnnotated(aBytes);
console.log(`\nB Pella..cb_hdr (${bBytes.length} bytes):`);
hexdumpAnnotated(bBytes);

function hexdumpAnnotated(buf) {
  for (let i = 0; i < buf.length; i += 8) {
    let hex = '';
    let dec = '';
    for (let j = 0; j < 8 && i+j < buf.length; j++) {
      const b = buf[i+j];
      hex += b.toString(16).padStart(2, '0') + ' ';
    }
    if (i + 4 <= buf.length) {
      const u32 = buf.readUInt32LE(i);
      dec = ` u32=${u32}`;
    }
    console.log(`  +${i.toString().padStart(4)}: ${hex.padEnd(24)} ${dec}`);
  }
}

// Now, the simple observation: A goes from Pella+50 to cb_hdr in ~55 bytes,
// B goes from Pella+50 to cb_hdr in 108 bytes (Δ=53 bytes).
// The +53 extra bytes in B are the construction queue.
// Let me extract just the 53-byte extra block carefully.
//
// Strategy: A has a known structure ending the segment:
//   01 00 00 00 00 00 00 00 01 00 00 00 0b 00 00 00 [u32 self-ptr]
// B should have the same trailing structure, just shifted.
// Find that pattern in B working backward from cb_hdr.

const tailPattern = Buffer.from('01000000000000000100000000000000010000000b000000', 'hex');
const aTailPos = aBytes.indexOf(tailPattern);
const bTailPos = bBytes.indexOf(tailPattern);
console.log(`\nA tail pattern starts at +${aTailPos}`);
console.log(`B tail pattern starts at +${bTailPos}`);

// Whatever's BEFORE the tail pattern in B (but not in A) is the construction queue.
if (aTailPos > 0 && bTailPos > 0 && bTailPos > aTailPos) {
  console.log(`\nB EXTRA INSERT (Pella+${aTailPos}..+${bTailPos}, length=${bTailPos - aTailPos}):`);
  hexdumpAnnotated(B.slice(bPella + aTailPos, bPella + bTailPos));
  // Compare with what's in A at the same logical position
  console.log(`A bytes at Pella+${aTailPos}.. (just for context, ${0} bytes):`);
}
