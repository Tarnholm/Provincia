// Find unit experience (0-9) and upgrade levels (0-3) in the state block.
// These should be small bytes/ints with bounded values.

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
        UNITS.push({ off: p, type: s, location: locRec.str, stateStart: locOff + locRec.totalLen });
      }
    }
  }
  p = q + 1;
}

// Look for BYTE fields (u8) in 0..9 range (experience) or 0..3 range (upgrades)
// At every byte offset in the first 256 bytes of state
console.log('=== u8 fields with values 0-9 (potential experience) ===');
for (let relOff = 0; relOff < 300; relOff++) {
  const vals = [];
  for (const u of UNITS) {
    if (u.stateStart + relOff >= buf.length) continue;
    vals.push(buf[u.stateStart + relOff]);
  }
  // Count how many are in 0..9 (experience range)
  const in09 = vals.filter(v => v <= 9).length;
  const ratio = in09 / vals.length;
  if (ratio > 0.95 && new Set(vals).size > 1 && new Set(vals).size <= 12) {
    // Histogram
    const counts = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    const dist = Object.entries(counts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([k, v]) => k + ':' + v).join(', ');
    console.log('  u8@+' + String(relOff).padStart(3) + ' (' + (ratio*100).toFixed(0) + '% in 0-9): unique=' + new Set(vals).size + ' dist={' + dist + '}');
  }
}

// 0-3 range (upgrade levels for weapon/armor)
console.log('\n=== u8 fields with values 0-3 (potential weapon/armor upgrade) ===');
for (let relOff = 0; relOff < 300; relOff++) {
  const vals = [];
  for (const u of UNITS) {
    if (u.stateStart + relOff >= buf.length) continue;
    vals.push(buf[u.stateStart + relOff]);
  }
  const in03 = vals.filter(v => v <= 3).length;
  const ratio = in03 / vals.length;
  if (ratio > 0.97 && new Set(vals).size > 1 && new Set(vals).size <= 5) {
    const counts = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    const dist = Object.entries(counts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([k, v]) => k + ':' + v).join(', ');
    console.log('  u8@+' + String(relOff).padStart(3) + ' (' + (ratio*100).toFixed(0) + '% in 0-3): dist={' + dist + '}');
  }
}

// Also check if naval biremes have different stats (they're at sea)
// to test if state+12 is consistent across unit types
console.log('\n=== Sample units with their state+12 (soldier count) and state+0..8 bytes ===');
const SAMPLES = ['roman generals guard cavalry early', 'greek hoplite militia', 'naval biremes',
  'east horse archer', 'spanish scutarii', 'barb infantry gaul'];
for (const target of SAMPLES) {
  const units = UNITS.filter(u => u.type === target);
  if (units.length === 0) continue;
  console.log('\n  ' + target + ' (' + units.length + ' units):');
  for (const u of units.slice(0, 3)) {
    const u32_0 = buf.readUInt32LE(u.stateStart);
    const u32_4 = buf.readUInt32LE(u.stateStart + 4);
    const u32_8 = buf.readUInt32LE(u.stateStart + 8);
    const u32_12 = buf.readUInt32LE(u.stateStart + 12);
    console.log('    ' + u.location.padEnd(20) + ' state+0=' + u32_0 + ' +4=' + u32_4 + ' +8=' + u32_8 + ' +12=' + u32_12);
  }
}
