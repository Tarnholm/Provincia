// Verify the per-settlement tile-coordinate decoding for all 103 settlements

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const t1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const defSets = findPstr16Asciiz(t1, 'default_set');

const SETTLEMENT_COORDS = [];
for (const ds of defSets) {
  // Find preceding name
  let nameOff = -1;
  for (let step = -20; step <= 0; step++) {
    const candidate = ds - 18 + step;
    if (candidate < 0) continue;
    const r = readPstr16Utf16(t1, candidate);
    if (r && r.totalLen === ds - candidate - 18) {
      nameOff = candidate;
      break;
    }
  }
  const headerStart = ds + 14;  // bytes after "default_set" pstr16
  const tileX = t1.readUInt32LE(headerStart + 12);
  const tileY = t1.readUInt32LE(headerStart + 16);
  const name = nameOff !== -1 ? readPstr16Utf16(t1, nameOff).str : '<unknown>';
  SETTLEMENT_COORDS.push({ name, defSet: ds, tileX, tileY });
}

console.log('=== All 103 settlements with tile coordinates ===');
for (const s of SETTLEMENT_COORDS) {
  console.log('  0x' + s.defSet.toString(16).padStart(6, '0') + '  (' + String(s.tileX).padStart(3) + ', ' + String(s.tileY).padStart(3) + ')  ' + s.name);
}

// Spot-check Spain's settlements (Carthago_Nova, Corduba, Numantia, Asturica)
// Vanilla coords roughly:
//   Carthago_Nova: (27, 68)
//   Corduba: (20, 65)
//   Numantia: (33, 76)
//   Asturica: (15, 82)
console.log('\n=== Spanish settlements (expected low X around 15-33) ===');
for (const s of SETTLEMENT_COORDS) {
  if (['Carthago_Nova', 'Corduba', 'Numantia', 'Asturica', 'Scallabis', 'Osca'].includes(s.name)) {
    console.log('  ' + s.name + ': (' + s.tileX + ', ' + s.tileY + ')');
  }
}

// X range and Y range
const xs = SETTLEMENT_COORDS.map(s => s.tileX);
const ys = SETTLEMENT_COORDS.map(s => s.tileY);
console.log('\nX range: ' + Math.min(...xs) + '..' + Math.max(...xs));
console.log('Y range: ' + Math.min(...ys) + '..' + Math.max(...ys));
