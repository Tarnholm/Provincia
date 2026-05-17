// Look at what comes after "default_set" string in each settlement record.
// The actual built buildings should be encoded as IDs or names here.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// "default_set\0" is 12 bytes; pstr16 adds 2 byte prefix; total 14 bytes
function hex(buf, off, len) {
  const slice = buf.slice(off, off + len);
  return Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;  // null terminator
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const body = Buffer.from(str + '\0');
  const target = Buffer.concat([prefix, body]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

// Find all "default_set" markers
const defSets = findPstr16Asciiz(peace, 'default_set');
console.log('Total "default_set" hits:', defSets.length);
// For first 10, dump 80 bytes after
for (const ds of defSets.slice(0, 6)) {
  const after = ds + 14;
  console.log('\n=== After default_set @ 0x' + ds.toString(16) + ' (data at 0x' + after.toString(16) + ') ===');
  console.log('  +0..15:  ' + hex(peace, after, 16));
  console.log('  +16..31: ' + hex(peace, after + 16, 16));
  console.log('  +32..47: ' + hex(peace, after + 32, 16));
  console.log('  +48..63: ' + hex(peace, after + 48, 16));
  // Look for next ASCIIZ pstr16
  for (let p = after; p < after + 200; p++) {
    const lenP1 = peace.readUInt16LE(p);
    if (lenP1 > 3 && lenP1 < 60) {
      let allPrintable = true;
      for (let j = 0; j < lenP1 - 1; j++) {
        const c = peace[p + 2 + j];
        if (c < 0x20 || c > 0x7e) { allPrintable = false; break; }
      }
      if (allPrintable && peace[p + 2 + lenP1 - 1] === 0) {
        const s = peace.slice(p + 2, p + 2 + lenP1 - 1).toString('latin1');
        if (/^[a-z_][a-z_0-9]*$/.test(s)) {
          console.log('  Next ASCIIZ pstr16 at +' + (p - after) + ': "' + s + '"');
          break;
        }
      }
    }
  }
}

// Compare with vanilla descr_strat: Carthago_Nova should have what buildings at start?
// In vanilla 1.5: settlements have ruler_palace, market, governors_villa, etc.
// Let me also check the bytes between the name pstr16 and "default_set" — there's a 0x12 byte gap.
console.log('\n=== Bytes between name and default_set for first 3 ===');
const sample = [['Carthago_Nova', 0x32618], ['Corduba', 0x242cd], ['Numantia', 0x27795]];
for (const [name, strlenOff] of sample) {
  const nameLen = peace.readUInt16LE(strlenOff);
  const nameEnd = strlenOff + 2 + nameLen * 2;
  const defSet = peace.indexOf(Buffer.from([12, 0, 100, 101, 102]), nameEnd);  // [12,0,'d','e','f']
  console.log('\n=== ' + name + ' (nameEnd=0x' + nameEnd.toString(16) + ', defSet=0x' + defSet.toString(16) + ') ===');
  if (defSet > nameEnd && defSet < nameEnd + 100) {
    console.log('  gap bytes:', hex(peace, nameEnd, defSet - nameEnd));
  }
}
