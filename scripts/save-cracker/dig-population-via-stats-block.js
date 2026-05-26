// Use memory: stats block has population@+548 from block start. Name comes AFTER stats.
// For each Spain settlement, check candidates at:
//   - name_offset - 583 + 548 = name - 35  (if stats are 583 bytes BEFORE name)
//   - name_offset + 20 + 548 = name + 568  (if stats are AFTER name + 20-byte UTF-16)

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

const settlementNames = ['Corduba', 'Numantia', 'Asturica', 'Scallabis', 'Osca'];

// For each settlement, scan -1500..+1500 and find any value that LOOKS like a population
// (in range 1500-50000) and is u32-aligned.
console.log('=== Plausible population fields near each Spain settlement (any value) ===');
for (const name of settlementNames) {
  const off = findUtf16(T1, name);
  if (off === -1) continue;
  console.log('\n' + name + ' @ 0x' + off.toString(16) + ':');
  const candidates = [];
  for (let dx = -1500; dx < 1500; dx += 4) {
    const p = off + dx;
    if (p < 0 || p + 4 > T1.length || p + 4 > T2.length) continue;
    const v1 = T1.readUInt32LE(p);
    const v2 = T2.readUInt32LE(p);
    if (v1 < 1500 || v1 > 50000) continue;
    if (Math.abs(v2 - v1) > 5000) continue;  // pop can grow but not by 5000+
    candidates.push({ dx, p, v1, v2 });
  }
  for (const c of candidates.slice(0, 10)) {
    console.log('  dx=' + c.dx.toString().padStart(5) + '  T1=' + c.v1 + '  T2=' + c.v2 + '  Δ=' + (c.v2 - c.v1));
  }
}

// Check if there's a SINGLE dx that gives plausible populations for ALL settlements
console.log('\n=== Settlement-relative dx with population values across multiple settlements ===');
const dxToVals = {};
for (const name of settlementNames) {
  const off = findUtf16(T1, name);
  if (off === -1) continue;
  for (let dx = -1500; dx < 1500; dx += 4) {
    const p = off + dx;
    if (p < 0 || p + 4 > T1.length) continue;
    const v1 = T1.readUInt32LE(p);
    if (v1 < 1500 || v1 > 50000) continue;
    if (!dxToVals[dx]) dxToVals[dx] = [];
    dxToVals[dx].push({ name, v1 });
  }
}

// Find dx values where AT LEAST 3 settlements have plausible pop
const goodDx = Object.entries(dxToVals).filter(([_, v]) => v.length >= 3);
console.log('Found ' + goodDx.length + ' dx values appearing in 3+ settlements');
goodDx.sort((a, b) => b[1].length - a[1].length);
for (const [dx, vals] of goodDx.slice(0, 20)) {
  console.log('  dx=' + dx + ': ' + vals.length + ' settlements with pop values ' + vals.map(v => v.name + '=' + v.v1).join(', '));
}
