// Settlements' stats_block+0 is CREATOR (revolt-to faction). We need to find the
// LIVE OWNER. In Spain's saves, all 5 settlements are Spain-owned (faction=18) at T1.
// So scan the stats block (0..583 bytes before name) for a byte that = 18 in all 5 settlements.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const settlements = ['Corduba', 'Numantia', 'Asturica', 'Scallabis', 'Osca'];

// Verify the same dx works in T2
console.log('=== Verify stats fields in T2 ===');
console.log('Settlement  | creator | level | PO  | income | population');
for (const name of settlements) {
  const off = findUtf16(T2, name);
  if (off === -1) { console.log('  ' + name + ' NOT FOUND in T2'); continue; }
  const creator = T2.readInt32LE(off - 583);
  const level = T2.readInt32LE(off - 571);
  const po = T2.readInt32LE(off - 435);
  const income = T2.readInt32LE(off - 127);
  const pop = T2.readInt32LE(off - 35);
  console.log('  ' + name.padEnd(11) + ' | ' + creator.toString().padStart(7) + ' | ' + level.toString().padStart(5) + ' | ' + po.toString().padStart(3) + ' | ' + income.toString().padStart(6) + ' | ' + pop.toString().padStart(8));
}

// Now scan stats block for OWNER (= 18 for all 5 settlements in T1)
console.log('\n=== Scan stats block (dx -583..0) for byte/u32 = 18 (Spain) in all 5 settlements ===');
const dxCounts = { u8: {}, u32: {} };
for (const name of settlements) {
  const off = findUtf16(T1, name);
  for (let dx = -583; dx <= 0; dx++) {
    if (off + dx < 0) continue;
    const u8v = T1[off + dx];
    if (u8v === 18) {
      dxCounts.u8[dx] = (dxCounts.u8[dx] || 0) + 1;
    }
    if (dx % 4 === 0 || true) {
      if (off + dx + 4 > T1.length) continue;
      const u32v = T1.readUInt32LE(off + dx);
      if (u32v === 18) {
        dxCounts.u32[dx] = (dxCounts.u32[dx] || 0) + 1;
      }
    }
  }
}
console.log('\nDX with u8=18 in MULTIPLE settlements (likely owner-byte candidate):');
for (const [dx, count] of Object.entries(dxCounts.u8).sort((a, b) => b[1] - a[1])) {
  if (parseInt(count) >= 3) console.log('  dx=' + dx + ': ' + count + ' settlements');
}
console.log('\nDX with u32=18 in MULTIPLE settlements:');
for (const [dx, count] of Object.entries(dxCounts.u32).sort((a, b) => b[1] - a[1])) {
  if (parseInt(count) >= 3) console.log('  dx=' + dx + ': ' + count + ' settlements');
}
