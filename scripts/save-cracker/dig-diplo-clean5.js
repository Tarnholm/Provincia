// Session 32 step 5: zoom on key changes.
// 0x103286 and 0xa775de both flip "05 00 00 00 00" -> "00 00 00 00 01" — duplicated!
// 0xf846e0+ region has 1-byte insertions/deletions: u8=03 inserted, u8=ff deleted.
// Investigate context around each.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

function dump(buf, start, len, label) {
  console.log(`--- ${label} @ 0x${start.toString(16)} (${len} bytes) ---`);
  for (let i = 0; i < len; i += 16) {
    const off = start + i;
    const slice = buf.slice(off, Math.min(off + 16, start + len));
    const hexs = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asciis = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log(`  ${off.toString(16).padStart(8, '0')}: ${hexs.padEnd(48)} ${asciis}`);
  }
}

// 1. 0x103286 — show 256 bytes around
console.log('=== AREA 1: 0x103286 ===');
dump(a, 0x103200, 0x180, 'A pre');
dump(b, 0x103200, 0x180, 'B post');

// 2. 0xa775de — show 256 bytes around
console.log('\n=== AREA 2: 0xa775de ===');
dump(a, 0xa77550, 0x180, 'A pre');
dump(b, 0xa77550, 0x180, 'B post');

// 3. 0xa8e13 area (cluster of changes)
console.log('\n=== AREA 3: 0xa8e00 cluster ===');
dump(a, 0xa8e00, 0x100, 'A');
dump(b, 0xa8e00, 0x100, 'B');

// 4. 0xf846e0 — region with byte insertions
console.log('\n=== AREA 4: 0xf846e0 (per-record changes) ===');
dump(a, 0xf846a0, 0x180, 'A');
dump(b, 0xf846a0, 0x180, 'B');
