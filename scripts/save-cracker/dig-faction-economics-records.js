// Find FACTION_ECONOMICS records (type ID 91, count 36) in the save body
// and locate treasury per faction.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

// Spain starting treasury per descr_strat = 3000 (denarii)
// 3000 LE = b8 0b 00 00
const target = Buffer.from([0xb8, 0x0b, 0x00, 0x00]);
const targetT2_low = Buffer.from([0xa0, 0x0f, 0x00, 0x00]); // 4000
const targetT2_mid = Buffer.from([0xb0, 0x10, 0x00, 0x00]); // 4272

// First — find all positions where 3000 appears in T1
console.log('=== Positions where u32=3000 appears in T1 (Spain start treasury) ===');
let off = 0;
const positions3000 = [];
while (true) {
  const idx = T1.indexOf(target, off);
  if (idx === -1) break;
  // Verify it's u32-aligned read
  if (T1.readUInt32LE(idx) === 3000) positions3000.push(idx);
  off = idx + 1;
}
console.log('Found ' + positions3000.length + ' occurrences');
console.log('First 30: ' + positions3000.slice(0, 30).map(p => '0x' + p.toString(16)).join(', '));

// For each candidate, check what T2 reads at the SAME offset
// Treasury should grow from 3000 to ~4500 (Spain end-turn 1)
console.log('\n=== Candidates where T1=3000 AND T2 in range 3500..6000 (treasury after end-turn) ===');
const treasury = [];
for (const p of positions3000) {
  if (p + 4 > T2.length) continue;
  const v2 = T2.readUInt32LE(p);
  if (v2 >= 3500 && v2 <= 6000 && v2 !== 3000) {
    treasury.push({ off: p, t1: 3000, t2: v2, delta: v2 - 3000 });
  }
}
console.log('Found ' + treasury.length + ' treasury candidates');
for (const c of treasury) {
  console.log('  u32@0x' + c.off.toString(16) + '  T1=' + c.t1 + '  T2=' + c.t2 + '  Δ=+' + c.delta);
}

// Also check what's AROUND these candidates — are they followed by income / upkeep?
console.log('\n=== Context around top 5 treasury candidates ===');
for (const c of treasury.slice(0, 5)) {
  console.log('\nu32@0x' + c.off.toString(16) + ' T1->T2: ' + c.t1 + '->' + c.t2);
  // Print T1 context: 16 bytes before and 16 after
  const before = Array.from(T1.slice(c.off - 16, c.off)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const after = Array.from(T1.slice(c.off + 4, c.off + 4 + 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  T1 before: ' + before);
  console.log('  T1 after:  ' + after);
  // Print as u32s
  console.log('  T1 u32s around:');
  for (let i = -16; i <= 32; i += 4) {
    const v = T1.readInt32LE(c.off + i);
    const v2 = T2.readInt32LE(c.off + i);
    console.log('    +' + i.toString().padStart(3) + ': T1=' + v + '  T2=' + v2 + (i === 0 ? '   <-- candidate' : ''));
  }
}
