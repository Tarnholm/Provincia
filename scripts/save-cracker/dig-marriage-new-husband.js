// Find the +1 new character in T4 (the son-in-law husband) by UUID-set diff.
// Each role string is preceded by a 4-byte UUID; collect those UUIDs across
// both saves and find the one in T4 not in T3.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T3 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 3.sav'));
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Find all role strings and extract characters' UUIDs from the bytes preceding them.
// Layout (from the earlier dump):
//   role_string - 4..-1: u32 UUID (per-character)
//   role_string - 8..-5: another UUID (commander/bodyguard linkage)
function findCharacters(buf) {
  const roles = ['general', 'captain', 'diplomat', 'spy', 'assassin', 'merchant', 'admiral', 'governor'];
  const out = [];
  for (const role of roles) {
    const target = Buffer.from('roman ' + role + '\0', 'ascii');
    let p = 0;
    while (true) {
      const idx = buf.indexOf(target, p);
      if (idx === -1) break;
      p = idx + 1;
      if (idx < 16) continue;
      // UUID right before the length prefix (idx - 2 - 4)
      // Actually layout looking at our dumps: role_string is at idx, preceded by:
      //   idx-2..idx-1: u16 length prefix
      //   idx-4..idx-3: u16 (=length again for layoutB, or zeros)
      // Let me try a few UUID positions
      const uuidM4 = buf.readUInt32LE(idx - 4);
      const uuidM8 = buf.readUInt32LE(idx - 8);
      const uuidM12 = buf.readUInt32LE(idx - 12);
      const uuidM16 = buf.readUInt32LE(idx - 16);
      // Also after the role string, more UUIDs
      const afterLen = target.length;  // includes null
      const uuidP2 = buf.readUInt32LE(idx + afterLen + 0);
      const uuidP6 = buf.readUInt32LE(idx + afterLen + 4);
      out.push({ off: idx, role, uuidM4, uuidM8, uuidM12, uuidM16, uuidP2, uuidP6 });
    }
  }
  return out;
}

const t3chars = findCharacters(T3);
const t4chars = findCharacters(T4);
console.log('T3 characters via roles: ' + t3chars.length);
console.log('T4 characters via roles: ' + t4chars.length);

// Find characters in T4 whose AFTER-role UUID (uuidP2) doesn't exist in T3
const t3Set = new Set();
for (const c of t3chars) {
  t3Set.add(c.uuidM4);
  t3Set.add(c.uuidM8);
  t3Set.add(c.uuidP2);
  t3Set.add(c.uuidP6);
}
console.log('\nNew characters in T4 (UUIDs not seen in T3):');
let newCount = 0;
for (const c of t4chars) {
  if (!t3Set.has(c.uuidP2) && c.uuidP2 !== 0 && c.uuidP2 !== 0xffffffff) {
    newCount++;
    console.log('\n  NEW T4 char @ 0x' + c.off.toString(16) + ' role=' + c.role);
    console.log('    uuidM16=0x' + c.uuidM16.toString(16) + ' uuidM12=0x' + c.uuidM12.toString(16));
    console.log('    uuidM8=0x' + c.uuidM8.toString(16) + ' uuidM4=0x' + c.uuidM4.toString(16));
    console.log('    uuidP2=0x' + c.uuidP2.toString(16) + ' uuidP6=0x' + c.uuidP6.toString(16));
    // Full record dump 200 bytes before and 400 after
    console.log('\n  Full context (-200 to +400 from role string):');
    for (let j = -200; j < 400; j += 32) {
      const len = Math.min(32, 400 - j);
      const hex = Array.from(T4.slice(c.off + j, c.off + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(T4.slice(c.off + j, c.off + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
      const mark = (j === 0) ? '  ← role' : '';
      console.log('    ' + (j >= 0 ? '+' : '') + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|' + mark);
    }
  }
}
console.log('\nTotal new characters: ' + newCount);
