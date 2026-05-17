// Verify 0xc2de0 is treasury by checking values across ALL Spain saves
// including the same-turn variants

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

console.log('=== u32@0xc2de0 across ALL Spain saves ===');
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  if (0xc2de0 + 4 > buf.length) continue;
  const v = buf.readUInt32LE(0xc2de0);
  const year = buf.readInt32LE(0x514);
  console.log('  yr=' + year + ' sz=' + buf.length + ' u32=' + String(v).padStart(6) + '  ' + f);
}

// Also check nearby candidate offsets
console.log('\n=== Nearby offsets (might be other factions\' treasuries) ===');
const offs = [0xc2d2c, 0xc2d50, 0xc2d74, 0xc2d98, 0xc2dbc, 0xc2de0, 0xc2e04, 0xc2e28, 0xc2e4c, 0xc2e70, 0xc2e94];
for (const off of offs) {
  process.stdout.write('  u32@0x' + off.toString(16) + ': ');
  for (const f of allFiles.slice(0, 8)) {
    const buf = fs.readFileSync(path.join(BASE, f));
    if (off + 4 > buf.length) { process.stdout.write('NA '); continue; }
    process.stdout.write(String(buf.readUInt32LE(off)).padStart(6) + ' ');
  }
  console.log();
}
console.log('  files (in order):');
for (let i = 0; i < 8 && i < allFiles.length; i++) {
  console.log('    [' + i + '] ' + allFiles[i]);
}
