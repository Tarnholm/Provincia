// Smarter approach: find faction-economic records by looking for a STRUCTURED
// pattern. Each record has treasury + (probably) income + expenses fields.
// Spain T1 has treasury=2500. Income is ~1340/turn (T1→T2 grew by 1340).
//
// So Spain's faction record probably has the bytes:
//   [...][u32 2500][u32 income? near 1340][u32 expenses? smaller][...]
//
// Scan for "2500" with a NEARBY value in [1000, 3000] (income range) and another
// small value (expenses/upkeep).

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

// Spain T1 = 2500, T2 = 3840 (Δ=+1340 income, after upkeep)
// Find positions where T1 reads 2500
const positions2500 = [];
for (let p = 0; p < T1.length - 4; p++) {
  if (T1.readUInt32LE(p) === 2500) positions2500.push(p);
}
console.log('Positions where T1=2500: ' + positions2500.length);

// For each, look at the 80 bytes AROUND it in T2 and see what changed
console.log('\n=== T1=2500 positions with NEARBY changing fields in T2 (income flow) ===');
for (const p of positions2500) {
  // Find any u32 at p+dx (dx in -100..+100, step 4) where:
  //   T1 in [0..20000], T2 in [0..20000], delta in [-3000..+3000]
  const nearby = [];
  for (let dx = -80; dx <= 80; dx += 4) {
    if (dx === 0) continue;
    const q = p + dx;
    if (q < 0 || q + 4 > T1.length || q + 4 > T2.length) continue;
    const v1 = T1.readUInt32LE(q);
    const v2 = T2.readUInt32LE(q);
    if (v1 < 0 || v1 > 30000) continue;
    if (v2 < 0 || v2 > 30000) continue;
    const d = v2 - v1;
    if (Math.abs(d) > 4000) continue;
    if (v1 === v2 && v1 === 0) continue;
    nearby.push({ dx, v1, v2, d });
  }
  console.log('\nAt 0x' + p.toString(16) + ' (T1=2500, T2=' + T2.readUInt32LE(p) + '):');
  for (const n of nearby) {
    console.log('  +' + n.dx.toString().padStart(4) + ': T1=' + n.v1.toString().padStart(8) + ' T2=' + n.v2.toString().padStart(8) + ' Δ=' + (n.d >= 0 ? '+' : '') + n.d);
  }
}
