// Verify state+12 = soldier count by checking distribution across unit types

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

const UNITS = [];
let p = 0x37000;
while (p < buf.length) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 6 && len <= 50) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s) && s.includes(' ') && s[0] === s[0].toLowerCase()) {
      const afterType = p + len;
      let locOff = afterType;
      let locRec = null;
      for (let skip = 0; skip < 30; skip++) {
        const r = readPstr16Utf16(buf, afterType + skip);
        if (r && r.str.length >= 3) {
          locOff = afterType + skip;
          locRec = r;
          break;
        }
      }
      if (locRec) {
        const stateStart = locOff + locRec.totalLen;
        const u12 = buf.readUInt32LE(stateStart + 12);
        const u16val = buf.readUInt32LE(stateStart + 16);
        UNITS.push({ off: p, type: s, location: locRec.str, soldiers12: u12, soldiers16: u16val });
      }
    }
  }
  p = q + 1;
}

// Histogram of state+12 by unit type
console.log('=== Average soldier count (state+12) by unit type ===');
const byType = {};
for (const u of UNITS) {
  if (!byType[u.type]) byType[u.type] = [];
  byType[u.type].push(u.soldiers12);
}
const typeStats = Object.entries(byType)
  .map(([type, vals]) => ({ type, count: vals.length, avg: vals.reduce((a,b)=>a+b,0)/vals.length, min: Math.min(...vals), max: Math.max(...vals) }))
  .sort((a, b) => b.count - a.count);

console.log('type'.padEnd(40) + ' count avg  min  max');
for (const t of typeStats.slice(0, 30)) {
  console.log('  ' + t.type.padEnd(38) + String(t.count).padStart(3) + ' ' +
    t.avg.toFixed(1).padStart(5) + ' ' + String(t.min).padStart(4) + ' ' + String(t.max).padStart(4));
}

// State+12 vs state+16 — should be (current, max) so 12 <= 16
console.log('\n=== state+12 vs state+16 (likely current vs max soldiers) ===');
let equal = 0, less = 0, greater = 0;
for (const u of UNITS) {
  if (u.soldiers12 === u.soldiers16) equal++;
  else if (u.soldiers12 < u.soldiers16) less++;
  else greater++;
}
console.log('  state+12 == state+16: ' + equal);
console.log('  state+12 <  state+16: ' + less);
console.log('  state+12 >  state+16: ' + greater);

// Sample 10 units where 12 < 16 (units that took casualties)
console.log('\n=== Sample units where state+12 < state+16 (damaged units) ===');
const damaged = UNITS.filter(u => u.soldiers12 < u.soldiers16);
console.log('Total damaged: ' + damaged.length);
for (const u of damaged.slice(0, 10)) {
  console.log('  ' + u.type.padEnd(35) + ' @ ' + u.location.padEnd(20) + ' soldiers: ' + u.soldiers12 + '/' + u.soldiers16);
}
