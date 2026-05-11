// Check the byte-spillage diffs at offset +28 in cells [0][155] and [155][238].
const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

// Dump 64 bytes around 0x103197 and 0xa774ef.
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

console.log('=== [0][155] surroundings ===');
dump(a, 0x103180, 64, 'A');
dump(b, 0x103180, 64, 'B');

console.log('\n=== [155][238] surroundings ===');
dump(a, 0xa774d0, 64, 'A');
dump(b, 0xa774d0, 64, 'B');

console.log('\n=== [238][238] surroundings ===');
dump(a, 0xf846c0, 64, 'A');
dump(b, 0xf846c0, 64, 'B');
