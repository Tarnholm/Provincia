// For each candidate dx in the stats block, check if it's DYNAMIC (changes T1→T2)
// vs STATIC. Dynamic fields are likely income/population/PO. Static fields are
// creator/level/etc.

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

// Candidate dx values from previous sweep
const candidates = [
  { dx: -583, name: 'creator' },
  { dx: -571, name: 'level' },
  { dx: -567, name: '?' },
  { dx: -562, name: '?' },
  { dx: -543, name: 'creator<<8?' },
  { dx: -520, name: '?' },
  { dx: -508, name: '?' },
  { dx: -500, name: '?' },
  { dx: -496, name: '?' },
  { dx: -477, name: '?' },
  { dx: -435, name: 'PO' },
  { dx: -400, name: '?' },
  { dx: -396, name: '?' },
  { dx: -363, name: '?' },
  { dx: -359, name: '?' },
  { dx: -315, name: '?' },
  { dx: -311, name: '?' },
  { dx: -310, name: 'tax_rate?' },
  { dx: -287, name: '?' },
  { dx: -255, name: '?' },
  { dx: -223, name: 'pop_copy?' },
  { dx: -222, name: '?' },
  { dx: -127, name: 'income' },
  { dx: -123, name: '?' },
  { dx: -122, name: '?' },
  { dx: -115, name: '?' },
  { dx: -83, name: '?' },
  { dx: -79, name: '?' },
  { dx: -78, name: 'tax_rate?2' },
  { dx: -62, name: '?' },
  { dx: -47, name: 'wealth?' },
  { dx: -46, name: '?' },
  { dx: -35, name: 'population' },
  { dx: -34, name: '?' },
  { dx: -27, name: '?' },
  { dx: -9, name: '?' },
];

console.log('Settlement   ' + candidates.map(c => 'dx=' + c.dx).join(' '));
console.log('  T1 row format below for each settlement:');
console.log();

for (const name of settlements) {
  const off1 = findUtf16(T1, name);
  const off2 = findUtf16(T2, name);
  const vals1 = candidates.map(c => {
    const p = off1 + c.dx;
    if (p + 4 > T1.length) return 0;
    return T1.readUInt32LE(p);
  });
  const vals2 = candidates.map(c => {
    const p = off2 + c.dx;
    if (p + 4 > T2.length) return 0;
    return T2.readUInt32LE(p);
  });
  console.log(name.padEnd(11) + ' T1: ' + vals1.map(v => v.toString().padStart(6)).join(' '));
  console.log('           T2: ' + vals2.map(v => v.toString().padStart(6)).join(' '));
  const deltas = vals1.map((v, i) => vals2[i] - v);
  console.log('           Δ:  ' + deltas.map(v => (v >= 0 ? '+' : '') + v.toString().padStart(5)).join(' '));
  console.log();
}

// Summarize which dx values CHANGED in at least one settlement
console.log('=== Which dx values are DYNAMIC (change in at least one settlement)? ===');
for (const c of candidates) {
  let changed = false;
  for (const name of settlements) {
    const off1 = findUtf16(T1, name);
    const off2 = findUtf16(T2, name);
    const v1 = T1.readUInt32LE(off1 + c.dx);
    const v2 = T2.readUInt32LE(off2 + c.dx);
    if (v1 !== v2) { changed = true; break; }
  }
  console.log('  dx=' + c.dx.toString().padStart(4) + ' (' + c.name + '): ' + (changed ? 'DYNAMIC' : 'static'));
}
