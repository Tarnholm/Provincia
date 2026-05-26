// Find both "early hastati" units in T4 and diff their soldier records.
// One was retrained (weapon_lvl 1), the other not (weapon_lvl 0).
// The bytes that differ identify the weapon_lvl position.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));

function findAllAscii(buf, str) {
  const target = Buffer.from(str + '\0', 'ascii');
  const positions = [];
  let p = 0;
  while (true) {
    const idx = buf.indexOf(target, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

// Common Roman unit names — try variations
const candidates = [
  'early hastati', 'hastati', 'roman hastati',
  'early roman hastati', 'roman early hastati',
  'aor early hastati', 'aor hastati',
];

console.log('Searching T4 for unit name pstr16:');
for (const name of candidates) {
  const hits = findAllAscii(T4, name);
  if (hits.length > 0) console.log('  "' + name + '": ' + hits.length + ' @ [' + hits.map(p => '0x' + p.toString(16)).join(', ') + ']');
}

// Also scan a region near the army for any UNIT type strings (pstr16 ASCII multi-word)
// The army is around 0x1537aaa to 0x154b000 in T4. Scan that range for pstr16 strings.
function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

console.log('\nAll multi-word pstr16 ASCII strings in T4 army zone (0x1537000..0x154c000):');
const seen = new Set();
for (let p = 0x1537000; p < 0x154c000 && p < T4.length - 4; p++) {
  const r = readPstr16Asciiz(T4, p);
  if (r && r.str.length >= 4 && /^[a-z][a-z _]+$/.test(r.str) && r.str.includes(' ')) {
    if (!seen.has(p)) {
      seen.add(p);
      console.log('  0x' + p.toString(16) + ' (' + r.str.length + ' chars): "' + r.str + '"');
      p += r.totalLen;
    }
  }
}
