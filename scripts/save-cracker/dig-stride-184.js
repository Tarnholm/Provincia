// Verify 184-byte stride. Records appear to be 0xB8 bytes wide with:
//   +0: treasury
//   +4: 25600 (?)
// Spain T1 treasury 0 → T2 3840 (at 0x2c094 and 0x2c14c)
// But 0x2c5e1 also has T1=2500, T2=3840 — at a totally different offset.
// Hypothesis: 0x2c094/0x2c14c are in one type of record (income/queue?), 0x2c5e1 in another.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

// Find ALL positions where T2 reads 3840
const positions_t2_3840 = [];
for (let p = 0; p < T2.length - 4; p++) {
  if (T2.readUInt32LE(p) === 3840) positions_t2_3840.push(p);
}
console.log('Positions where T2=3840: ' + positions_t2_3840.length);
console.log('First 30: ' + positions_t2_3840.slice(0, 30).map(p => '0x' + p.toString(16)).join(', '));

// Find positions where T2=3840 in a tight cluster (consecutive 184-byte stride)
// Spacing 184 (0xb8) between consecutive hits
console.log('\n=== Check stride 184 between consecutive T2=3840 positions ===');
for (let i = 0; i < positions_t2_3840.length - 1; i++) {
  const diff = positions_t2_3840[i+1] - positions_t2_3840[i];
  if (diff === 184) {
    console.log('  0x' + positions_t2_3840[i].toString(16) + ' -> 0x' + positions_t2_3840[i+1].toString(16) + ' (diff=184)');
  }
}

// Now walk array starting at 0x2c094 with stride 184 for 36 records
// and see if values look like treasuries
console.log('\n=== Walk 184-byte stride array starting at 0x2c094 ===');
const STRIDE = 184;
const COUNT = 36;
const ARRAY_START = 0x2c094;

console.log('Record  | offset     | T1 @+0     | T2 @+0     | Δ       | T1 @+4   | T2 @+4   | T1 @+8');
for (let i = 0; i < COUNT; i++) {
  const off = ARRAY_START + i * STRIDE;
  if (off + 4 > T1.length || off + 4 > T2.length) break;
  const t1_0 = T1.readUInt32LE(off);
  const t2_0 = T2.readUInt32LE(off);
  const t1_4 = T1.readUInt32LE(off + 4);
  const t2_4 = T2.readUInt32LE(off + 4);
  const t1_8 = T1.readUInt32LE(off + 8);
  console.log('  ' + i.toString().padStart(3) + '   | 0x' + off.toString(16).padStart(6) +
    ' | ' + t1_0.toString().padStart(10) +
    ' | ' + t2_0.toString().padStart(10) +
    ' | ' + (t2_0 - t1_0).toString().padStart(7) +
    ' | ' + t1_4.toString().padStart(8) +
    ' | ' + t2_4.toString().padStart(8) +
    ' | ' + t1_8.toString().padStart(8));
}

// Also check the FAR position 0x2c5e1 — what kind of record is THAT?
console.log('\n=== What 0x2c5e1 actually is ===');
// Look at 0x2c094 to 0x2c5e1 distance
console.log('0x2c5e1 - 0x2c094 = 0x' + (0x2c5e1 - 0x2c094).toString(16) + ' = ' + (0x2c5e1 - 0x2c094) + ' bytes');
console.log('If stride=184, that\'s ' + ((0x2c5e1 - 0x2c094) / 184) + ' records away');
