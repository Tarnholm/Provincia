// Verify population candidate at dx=-436 from settlement name.
// For each Spain settlement, read T1 and T2 values at dx=-436 and dx=-440 (also dx=-96)
// and compare to expected growth (T1→T2 should grow by ~0.5-2% per turn).

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

const candidateOffsets = [-440, -436, -96, -116, 416, 904];

console.log('Spain settlement candidates (T1 vs T2 values at different dx):');
console.log('Settlement     | name@   | ' + candidateOffsets.map(d => 'dx=' + d).join(' | '));

const t1Names = {};
const t2Names = {};
for (const name of settlements) {
  t1Names[name] = findUtf16(T1, name);
  t2Names[name] = findUtf16(T2, name);
}

console.log('\nT1:');
for (const name of settlements) {
  const off = t1Names[name];
  const vals = candidateOffsets.map(d => {
    const p = off + d;
    if (p < 0 || p + 4 > T1.length) return 'N/A';
    return T1.readInt32LE(p);
  });
  console.log('  ' + name.padEnd(12) + ' | 0x' + off.toString(16) + ' | ' + vals.map(v => v.toString().padStart(8)).join(' | '));
}

console.log('\nT2:');
for (const name of settlements) {
  const off = t2Names[name];
  const vals = candidateOffsets.map(d => {
    const p = off + d;
    if (p < 0 || p + 4 > T2.length) return 'N/A';
    return T2.readInt32LE(p);
  });
  console.log('  ' + name.padEnd(12) + ' | 0x' + off.toString(16) + ' | ' + vals.map(v => v.toString().padStart(8)).join(' | '));
}

console.log('\nDelta (T2 - T1):');
for (const name of settlements) {
  const off1 = t1Names[name];
  const off2 = t2Names[name];
  const deltas = candidateOffsets.map(d => {
    const p1 = off1 + d;
    const p2 = off2 + d;
    if (p1 < 0 || p1 + 4 > T1.length) return 'N/A';
    if (p2 < 0 || p2 + 4 > T2.length) return 'N/A';
    return T2.readInt32LE(p2) - T1.readInt32LE(p1);
  });
  console.log('  ' + name.padEnd(12) + ' | ' + deltas.map(d => typeof d === 'number' ? d.toString().padStart(10) : d).join(' | '));
}
