// Spain has 5 SETTLEMENT type records in T1. These are likely the TOP-LEVEL settlement
// stat records with population, income, etc. Find them by looking for a section of 5
// consecutively-sized blocks.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

// Spain's 5 starting settlements in vanilla: Corduba, Carthago Nova, Numantia, Asturica, Carthia (or similar)
// Find them in T1
function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const candidates = ['Corduba', 'Carthago Nova', 'Numantia', 'Asturica', 'Scallabis', 'Osca',
  'Toletum', 'Olisipo', 'Tingis', 'Caralis', 'Palma', 'Carthage', 'Saguntum'];
console.log('Settlement name positions in T1:');
const spainSettlements = [];
for (const name of candidates) {
  const off = findUtf16(T1, name);
  if (off !== -1) {
    spainSettlements.push({ name, off });
    console.log('  ' + name.padEnd(20) + ' @ 0x' + off.toString(16));
  }
}

// Now look for population fields near each settlement name.
// Population should grow between T1 and T2 by a small percentage (0.1-3%).
// Try several offsets relative to settlement name.
console.log('\n=== Population candidates near each settlement (T1, T2 values) ===');
for (const s of spainSettlements) {
  console.log('\nSettlement: ' + s.name + ' @ 0x' + s.off.toString(16));
  // Look at -3000..+3000 for u32 values in [500, 50000] that grow by 1-100 between T1 and T2
  const popCandidates = [];
  for (let dx = -3000; dx < 3000; dx += 4) {
    const p = s.off + dx;
    if (p < 0 || p + 4 > T1.length || p + 4 > T2.length) continue;
    const v1 = T1.readUInt32LE(p);
    const v2 = T2.readUInt32LE(p);
    if (v1 < 500 || v1 > 50000) continue;
    if (v2 < v1) continue;
    if (v2 - v1 > 500) continue;
    if (v1 === v2) continue;
    if (v1 % 256 === 0) continue;
    popCandidates.push({ dx, p, v1, v2, delta: v2 - v1 });
  }
  // Show top 5
  popCandidates.sort((a, b) => a.delta - b.delta);
  for (const c of popCandidates.slice(0, 5)) {
    console.log('  dx=' + c.dx.toString().padStart(5) + '  @0x' + c.p.toString(16) + '  T1=' + c.v1 + ' T2=' + c.v2 + ' Δ=+' + c.delta);
  }
}

// Cross-reference: which DX is most common across settlements?
console.log('\n=== Most common relative offset of population field ===');
const dxCounts = {};
for (const s of spainSettlements) {
  for (let dx = -3000; dx < 3000; dx += 4) {
    const p = s.off + dx;
    if (p < 0 || p + 4 > T1.length || p + 4 > T2.length) continue;
    const v1 = T1.readUInt32LE(p);
    const v2 = T2.readUInt32LE(p);
    if (v1 < 500 || v1 > 50000) continue;
    const d = v2 - v1;
    if (d < 0 || d > 500) continue;
    if (v1 === v2) continue;
    if (v1 % 256 === 0) continue;
    dxCounts[dx] = (dxCounts[dx] || 0) + 1;
  }
}
const sortedDx = Object.entries(dxCounts).sort((a, b) => b[1] - a[1]);
console.log('Top 10 dx values appearing in MULTIPLE settlements:');
for (const [dx, count] of sortedDx.slice(0, 10)) {
  console.log('  dx=' + dx + ': appears in ' + count + ' settlements');
}
