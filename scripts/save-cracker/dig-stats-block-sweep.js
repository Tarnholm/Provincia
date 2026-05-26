// Sweep the entire 583-byte stats block, dumping u32 values per settlement
// to find more decoded fields.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const settlements = ['Corduba', 'Numantia', 'Asturica', 'Scallabis', 'Osca'];

// For each dx, read u32 from each settlement and look for fields where values
// are small/plausible across all 5 settlements.
console.log('=== Stats block u32 values for each settlement (T1) ===');
console.log('Looking for fields where all 5 values are: small (<=20), or all u32-like');

const dxToVals = {};
for (let dx = -583; dx <= 0; dx += 1) {
  const vals = [];
  for (const name of settlements) {
    const off = findUtf16(T1, name);
    if (off + dx < 0 || off + dx + 4 > T1.length) { vals.push(null); continue; }
    const v = T1.readUInt32LE(off + dx);
    vals.push(v);
  }
  dxToVals[dx] = vals;
}

// Categorize: all values 0..20 (likely flag/level/index)
console.log('\n=== dx where all 5 settlements have u32 in [0, 20] ===');
for (let dx = -583; dx <= 0; dx++) {
  const vals = dxToVals[dx];
  if (vals.every(v => v !== null && v >= 0 && v <= 20)) {
    // Skip if all same (constant)
    const unique = new Set(vals);
    if (unique.size === 1 && vals[0] === 0) continue;
    console.log('  dx=' + dx.toString().padStart(4) + ': [' + vals.join(', ') + ']');
  }
}

// Plausible "tax rate" (values 0..4) - all 5 settlements likely at "normal" = 2
console.log('\n=== dx where all 5 settlements have value in [0, 4] AND not all 0 ===');
for (let dx = -583; dx <= 0; dx++) {
  const vals = dxToVals[dx];
  if (vals.every(v => v !== null && v >= 0 && v <= 4)) {
    const unique = new Set(vals);
    if (unique.size === 1 && vals[0] === 0) continue;
    console.log('  dx=' + dx.toString().padStart(4) + ': [' + vals.join(', ') + ']');
  }
}

// Find dx where all 5 values are in a "reasonable settlement field" range
console.log('\n=== dx where all 5 settlements have u32 in [50, 5000] (income/po/etc.) ===');
const interestingDx = [];
for (let dx = -583; dx <= 0; dx += 4) {
  const vals = dxToVals[dx];
  if (vals.every(v => v !== null && v >= 50 && v <= 5000)) {
    const unique = new Set(vals);
    if (unique.size >= 3) {
      interestingDx.push({ dx, vals });
    }
  }
}
console.log('Found ' + interestingDx.length + ' candidates');
for (const c of interestingDx.slice(0, 40)) {
  console.log('  dx=' + c.dx.toString().padStart(4) + ': [' + c.vals.join(', ') + ']');
}
