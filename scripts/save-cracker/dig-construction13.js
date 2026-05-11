#!/usr/bin/env node
// Compute precise diff alignment between A=saveturn1start and B=saveturn1construction
// for the Pella pre-core_building region.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

const pellaUtf16 = Buffer.from('Pella', 'utf16le');
const aPella = A.indexOf(pellaUtf16);
const bPella = B.indexOf(pellaUtf16);

const cstr = Buffer.from('core_building\0');
const aCb = A.indexOf(cstr, aPella);
const bCb = B.indexOf(cstr, bPella);

console.log(`A: Pella @ 0x${aPella.toString(16)}, core_building @ 0x${aCb.toString(16)} (rel +${aCb - aPella})`);
console.log(`B: Pella @ 0x${bPella.toString(16)}, core_building @ 0x${bCb.toString(16)} (rel +${bCb - bPella})`);

// Look at bytes between Pella+0 and core_building start in each
const aSeg = A.slice(aPella, aCb);
const bSeg = B.slice(bPella, bCb);
console.log(`\nA segment (len=${aSeg.length}):`);
hexdump(aSeg);
console.log(`\nB segment (len=${bSeg.length}):`);
hexdump(bSeg);

// In B, also pull a bit of the core_building sub-record to compare with A
// Look at the COMMON STRUCTURE — both end with the same `[u32 self-ptr][u16=14][core_building]`
// Find from the back: how many bytes from the back are common?
let suffixCommon = 0;
const minLen = Math.min(aSeg.length, bSeg.length);
while (suffixCommon < minLen && aSeg[aSeg.length - 1 - suffixCommon] === bSeg[bSeg.length - 1 - suffixCommon]) {
  suffixCommon++;
}
console.log(`\nCommon suffix: ${suffixCommon} bytes`);

let prefixCommon = 0;
while (prefixCommon < minLen && aSeg[prefixCommon] === bSeg[prefixCommon]) {
  prefixCommon++;
}
console.log(`Common prefix: ${prefixCommon} bytes`);

// Show ONLY the diff part
console.log(`\nA diff middle (offset ${prefixCommon}..${aSeg.length - suffixCommon}):`);
hexdump(aSeg.slice(prefixCommon, aSeg.length - suffixCommon));
console.log(`B diff middle (offset ${prefixCommon}..${bSeg.length - suffixCommon}):`);
hexdump(bSeg.slice(prefixCommon, bSeg.length - suffixCommon));

// Let's also align by looking at what's at the end of A's segment, and find that same content in B
// A ends with: "01 00 00 00 0b 00 00 00 f3 0d 01 00 0e 00 [core_building start]"
// In B, find this same pattern: "01 00 00 00 0b 00 00 00"
const aTailMarker = aSeg.slice(aSeg.length - 32);
console.log(`\nA tail 32 bytes: ${aTailMarker.toString('hex')}`);
const bSearchStart = Math.max(0, bSeg.length - 64);
// Search for similar tail in B
console.log(`B last 64 bytes: ${bSeg.slice(bSearchStart).toString('hex')}`);

function hexdump(buf) {
  for (let i = 0; i < buf.length; i += 16) {
    let hex = '';
    let asc = '';
    for (let j = 0; j < 16 && i+j < buf.length; j++) {
      const b = buf[i+j];
      hex += b.toString(16).padStart(2, '0') + ' ';
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.';
    }
    console.log(`    +${i.toString().padStart(4)} ${hex.padEnd(48)}  ${asc}`);
  }
}
