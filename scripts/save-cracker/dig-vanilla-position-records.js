// Find vanilla Rome character position records using session 110's signature:
// self-pointer + tile X + tile Y + sub-tile + MP-remaining f32.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Session 110's position record signature:
// +0  u32 self-pointer (= pos)
// +4  u32 tile_X (1..1100)
// +8  u32 tile_Y (1..800)
// +12 u32 sub-tile fixed-point
// +0x36 f32 MP-remaining (could be 0..400)
// In RIS this was preceded by char UUID + type tag

function findPositionRecords(buf) {
  const hits = [];
  for (let N = 24; N < buf.length - 0x40; N++) {
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const type = buf.readUInt32LE(N - 12);
    if (type !== 6 && type !== 5 && type !== 4) continue;
    const x = buf.readUInt32LE(N);
    if (x < 1 || x > 1100) continue;
    const y = buf.readUInt32LE(N + 4);
    if (y < 1 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (!uuid) continue;
    hits.push({ pos: N - 4, type, x, y, uuid });
  }
  return hits;
}

const positions = findPositionRecords(peace);
console.log('=== Position records found in vanilla Rome ===');
console.log('Total: ' + positions.length);

// Distribution by type
const typeCount = new Map();
for (const p of positions) typeCount.set(p.type, (typeCount.get(p.type) || 0) + 1);
console.log('By type:');
for (const [t, n] of typeCount) console.log('  type=' + t + ': ' + n + ' records');

// Coord ranges
const xs = positions.map(p => p.x);
const ys = positions.map(p => p.y);
console.log('X range: ' + Math.min(...xs) + '..' + Math.max(...xs));
console.log('Y range: ' + Math.min(...ys) + '..' + Math.max(...ys));

// First 30 positions
console.log('\nFirst 30 records:');
console.log('  pos       type  x    y    uuid');
for (const p of positions.slice(0, 30)) {
  console.log('  0x' + p.pos.toString(16).padStart(6, '0') + '   ' + p.type + '   ' + String(p.x).padStart(3) + '  ' + String(p.y).padStart(3) + '  0x' + p.uuid.toString(16).padStart(8, '0'));
}

// Search for Spain's Corduba — known position from descr_strat. In vanilla RTW,
// Spain's starting capital Carthago_Nova is around (40, 67) or similar.
// Let me find any position records in the Spanish region of the map.
console.log('\n=== Records in Spanish map region (X<80, Y<80) ===');
const spanish = positions.filter(p => p.x < 80 && p.y < 80);
console.log('Total in Spanish region: ' + spanish.length);
for (const p of spanish.slice(0, 20)) {
  console.log('  0x' + p.pos.toString(16) + '   type=' + p.type + '  (' + p.x + ', ' + p.y + ')  uuid=0x' + p.uuid.toString(16));
}
