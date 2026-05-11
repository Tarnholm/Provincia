// Session 32 step N: locate DIPLOMATIC_ATTITUDE in HST and find its data offset.
const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));

// HST starts ~0x3328 per RESEARCH. Find DIPLOMATIC_ATTITUDE.
const big = a.toString('latin1');
const idx = big.indexOf('DIPLOMATIC_ATTITUDE');
console.log(`DIPLOMATIC_ATTITUDE found at 0x${idx.toString(16)}`);
// HST is "ASCIIZ name, u32 version" pairs.
// Print 256 bytes around it.
for (let i = Math.max(0, idx - 32); i < idx + 64; i += 16) {
  const slice = a.slice(i, i + 16);
  const hex = Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
  console.log(`  ${i.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} ${ascii}`);
}

// Now look for "FACTION" string in HST too.
const factionIdx = big.indexOf('FACTION');
console.log(`\nFACTION found at 0x${factionIdx.toString(16)}`);

// Check whether the byte-stream we identified is a section. Each is ~50 bytes wide and ends with `00 ff 00 ff 00 ff 00 XX`. Look at the start.
// The byte XX (after 00 ff 00 ff 00 ff 00) might be a section termination marker.
// And the bytes look like u8 enums.
// Let me look at the FIRST few bytes of the diplomatic-attitude region:
console.log(`\n=== Diplomatic-history region 0x1f1d000..0x1f1dc00 ===`);
for (let i = 0x1f1d000; i < 0x1f1dc00; i += 16) {
  const slice = a.slice(i, i + 16);
  const hex = Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
  console.log(`  ${i.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} ${ascii}`);
}
