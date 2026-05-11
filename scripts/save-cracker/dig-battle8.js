#!/usr/bin/env node
// Check 0x111ec across multiple Alexander saves to interpret it.
// Also check the building damaged byte across multiple settlements.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const saves = [
  'save_saveturn1start.sav',
  'save_saveturn1building.sav',
  'save_saveturn1construction.sav',
  'save_saveturn1move.sav',
  'save_saveturn2start.sav',
  'save_Noarmiesmovedturn1.sav',
  'save_notdamagedturn1.sav',
  'save_damagedturn1.sav',
  'save_damagedturn2.sav',
];

console.log('=== Byte at 0x111ec across saves ===');
for (const s of saves) {
  const buf = fs.readFileSync(path.join(dir, s));
  // The damaged saves are different size, so offset shifts
  console.log(`${s}: file size=${buf.length}, byte@0x111ec=${buf[0x111ec]}`);
}

// In damaged saves, where do all the "u32=100" patterns appear?
// The save_notdamagedturn1.sav is 1189090 bytes; bigger than save_saveturn1start (1051379).
// So the structure is different. Let me look at where 0x111ec actually is in the saveturn1start.

// Better question: what sub-record is 0x111ec inside?
// In notdamaged: 0x111ec is in the "market" sub-record of some settlement (per the context).
// What settlement?
const buf = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
// Search backward for UTF-16LE settlement name
console.log('\n=== Searching for UTF-16LE settlement name backward from 0x111ec ===');
for (let i = 0x111ec; i > 0x111ec - 4096; i--) {
  // Check for `01 LEN_LO LEN_HI` pattern
  if (buf[i] === 0x01 && buf[i+1] < 30 && buf[i+1] > 2 && buf[i+2] === 0) {
    const len = buf.readUInt16LE(i + 1);
    if (len >= 3 && len <= 30) {
      const nameStart = i + 3;
      let s = '';
      let ok = true;
      for (let j = 0; j < len; j++) {
        const c = buf.readUInt16LE(nameStart + j * 2);
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
        s += String.fromCharCode(c);
      }
      if (ok && /^[A-Z][a-z]/.test(s)) {
        console.log(`  Found settlement name at 0x${i.toString(16)}: "${s}" (rel to 0x111ec: ${0x111ec - i})`);
        if (0x111ec - i < 3000) break;
      }
    }
  }
}

// What was the value at 0x111ec across the saves of different size?
// Check each save: find market sub-record near the start of the body and look at +60 offset
console.log('\n=== Scanning for market sub-records in damaged/notdamaged saves ===');
const cstr = Buffer.from('market\0');
for (const s of ['save_notdamagedturn1.sav', 'save_damagedturn1.sav', 'save_damagedturn2.sav']) {
  const buf2 = fs.readFileSync(path.join(dir, s));
  let pos = 0;
  let count = 0;
  while ((pos = buf2.indexOf(cstr, pos)) !== -1) {
    // Read u32 at pos + 24 (estimating "level/state" offset based on pattern)
    // Actually from context: market starts at 0x111c5, value at 0x111ec = +39 = pos+39
    // Let's read u32 at pos+33 (= 0x111e8) which holds u32=4 (= level?)
    // and u32 at pos+39 (= 0x111ee) which is actually misaligned because 0x111ec is u8.
    // Better: pos+33 = u32 (4 or 5), pos+37 = u8, pos+38 = u8.
    // From hex: at 0x111ec position we have `04 00 00 00 64 00 00 00`
    // So u32 at pos+33 = 4, u32 at pos+37 = 100 (= 0x64)
    // Wait the cstring is at pos. So bytes pos..pos+5 = "market", then null at pos+6.
    // Position 0x111ec is at pos + (0x111ec - pos) = let's compute:
    // In notdamaged save, "market" cstring is at 0x111c5 (per the search above)
    // 0x111ec - 0x111c5 = 39
    // So 39 bytes past "market\0"
    if (count < 5) {
      const aval = buf2.readUInt32LE(pos + 37);
      console.log(`  ${s} market[${count}] @ 0x${pos.toString(16)}: u32@+37=${aval}, u32@+33=${buf2.readUInt32LE(pos + 33)}`);
    }
    pos += 1;
    count++;
  }
  console.log(`  Total "market" sub-records: ${count}`);
}
