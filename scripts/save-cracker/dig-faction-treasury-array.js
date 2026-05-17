// Look for an ARRAY of 34 u32 values that look like per-faction treasuries

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));
const T_FILES = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      if (!T_FILES[t]) T_FILES[t] = fs.readFileSync(path.join(BASE, f));
      break;
    }
  }
}
const buf = T_FILES[4];
const len = Math.min(...Object.values(T_FILES).map(b => b.length));

console.log('Scanning for 34-element treasury-like u32 arrays...');
const candidates = [];
for (let arrayStart = 0x100; arrayStart < len - 34 * 4; arrayStart += 4) {
  const vals = [];
  for (let i = 0; i < 34; i++) vals.push(buf.readUInt32LE(arrayStart + i * 4));
  const inRange = vals.filter(v => v >= 0 && v < 100000).length;
  if (inRange < 28) continue;
  if (new Set(vals).size < 8) continue;
  if (vals.filter(v => v > 500).length < 10) continue;
  if (vals.some(v => v > 200000)) continue;
  candidates.push({ start: arrayStart, vals });
}

console.log('Found ' + candidates.length + ' candidate 34-element arrays');
for (const c of candidates.slice(0, 10)) {
  console.log('\n  0x' + c.start.toString(16) + ':');
  console.log('    vals: [' + c.vals.join(', ') + ']');
  let varying = 0;
  for (let i = 0; i < 34; i++) {
    const v1 = T_FILES[1].readInt32LE(c.start + i * 4);
    const v4 = T_FILES[4].readInt32LE(c.start + i * 4);
    if (v1 !== v4) varying++;
  }
  console.log('    Positions varying T1→T4: ' + varying);
}

// Also try 21 elements (= vanilla faction count)
console.log('\n\n=== Trying 21-element arrays (= 20 playable + slave) ===');
const c21 = [];
for (let arrayStart = 0x100; arrayStart < len - 21 * 4; arrayStart += 4) {
  const vals = [];
  for (let i = 0; i < 21; i++) vals.push(buf.readUInt32LE(arrayStart + i * 4));
  const inRange = vals.filter(v => v >= 0 && v < 50000).length;
  if (inRange < 18) continue;
  if (new Set(vals).size < 7) continue;
  if (vals.filter(v => v > 500).length < 8) continue;
  if (vals.some(v => v > 100000)) continue;
  c21.push({ start: arrayStart, vals });
}
console.log('Found ' + c21.length + ' 21-element candidates');
for (const c of c21.slice(0, 10)) {
  console.log('\n  0x' + c.start.toString(16) + ':');
  console.log('    vals: [' + c.vals.join(', ') + ']');
  let varying = 0;
  for (let i = 0; i < 21; i++) {
    const v1 = T_FILES[1].readInt32LE(c.start + i * 4);
    const v4 = T_FILES[4].readInt32LE(c.start + i * 4);
    if (v1 !== v4) varying++;
  }
  console.log('    Positions varying T1→T4: ' + varying);
}
