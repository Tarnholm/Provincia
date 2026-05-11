// Session 32 step M: dump the 0x1f1dca3..0x1f1ddc5 area where the -10 size delta originates.
// This is likely a diplomatic-history table that got modified.

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

console.log('=== A around 0x1f1dca0..0x1f1ddff ===');
dump(a, 0x1f1dc00, 0x300, 'A');
console.log('\n=== B around 0x1f1dc00..0x1f1de00 ===');
dump(b, 0x1f1dc00, 0x300, 'B');
