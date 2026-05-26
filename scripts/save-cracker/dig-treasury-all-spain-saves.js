// Verify treasury offset across ALL Spain saves using TAW invariant section walker.
// Memory says: "taw section invariant {u32 offset==pos, u32 size}"

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE_R).filter(f => f.endsWith('.sav') && /Spain/.test(f));

console.log('Spain saves found:');
for (const f of allFiles) console.log('  ' + f);

// Check 0x2c5e1 across all
console.log('\n=== u32@0x2c5e1 across Spain saves ===');
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE_R, f));
  if (0x2c5e1 + 4 > buf.length) continue;
  const v = buf.readUInt32LE(0x2c5e1);
  const fileLen = buf.length;
  // Try to find the year (u32 at 0x514 typically)
  console.log('  ' + f.substring(0, 60).padEnd(62) + '  sz=' + fileLen.toString().padStart(8) + '  u32@0x2c5e1=' + v);
}

// Now find sections via TAW invariant: u32 offset==position, followed by u32 size
console.log('\n=== TAW invariant section starts in T1 ===');
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const sections = [];
for (let p = 0x3000; p < T1.length - 8; p += 1) {
  const v = T1.readUInt32LE(p);
  if (v === p) {
    const size = T1.readUInt32LE(p + 4);
    if (size > 16 && size < 0x100000 && p + size <= T1.length) {
      sections.push({ off: p, size });
    }
  }
}
console.log('Found ' + sections.length + ' candidate sections');
console.log('First 25:');
for (const s of sections.slice(0, 25)) {
  console.log('  0x' + s.off.toString(16).padStart(6) + '  size=' + s.size);
}

// Which section contains 0x2c5e1?
console.log('\n=== Section containing 0x2c5e1 ===');
for (const s of sections) {
  if (s.off <= 0x2c5e1 && s.off + s.size > 0x2c5e1) {
    const relOff = 0x2c5e1 - s.off;
    console.log('  Section @0x' + s.off.toString(16) + ' size=' + s.size + '  treasury is at rel +' + relOff + ' (0x' + relOff.toString(16) + ')');
  }
}
