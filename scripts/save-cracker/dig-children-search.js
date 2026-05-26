// Look for children references AFTER the bodyguard soldier array of an existing
// general. Also find non-role character records (the wives + young children).

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Pick a known married existing general (Roma region, age 60): 0x153c8ef
const GEN = 0x153c8ef;
const ownUuid = T4.readUInt32LE(GEN + 15);
const spouseUuid = T4.readUInt32LE(GEN + 49);  // For "roman general" + "Roma" (L=4)
console.log('Existing general @ 0x' + GEN.toString(16));
console.log('  own_uuid = 0x' + ownUuid.toString(16));
console.log('  spouse_uuid = 0x' + spouseUuid.toString(16));

// Dump 800 bytes following the bodyguard to look for children references.
// Bodyguard typically ~32-64 soldiers * 9 bytes = ~300-600 bytes.
// Start dumping from +65 (after stat slots) onwards.
console.log('\nGeneral record from +65 to +800:');
for (let j = 65; j < 1000; j += 32) {
  const hex = Array.from(T4.slice(GEN + j, GEN + j + 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(T4.slice(GEN + j, GEN + j + 32)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|');
}

// Now search T4 for the spouse's UUID — should appear inside the wife's record
const spouseBuf = Buffer.alloc(4);
spouseBuf.writeUInt32LE(spouseUuid, 0);
let p = 0;
const spouseHits = [];
while (true) {
  const idx = T4.indexOf(spouseBuf, p);
  if (idx === -1) break;
  spouseHits.push(idx);
  p = idx + 1;
}
console.log('\nSpouse UUID 0x' + spouseUuid.toString(16) + ' appears ' + spouseHits.length + ' times.');
for (const h of spouseHits.slice(0, 5)) {
  console.log('  @ 0x' + h.toString(16) + ':');
  for (let j = -16; j <= 64; j += 16) {
    const hex = Array.from(T4.slice(h + j, h + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T4.slice(h + j, h + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = j === 0 ? '  ← spouse UUID' : '';
    console.log('    ' + (j >= 0 ? '+' : '') + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|' + mark);
  }
}
