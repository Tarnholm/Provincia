// Look inside the Macedon major-faction record (which is at 0x3dcc3 in T97 per dig-battle-log2)
// for battle history embedded as a list of records.
// Macedon at T97 must have had many battles.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');

// Find the major-faction records using session 5's signature
// +8 = 100, +12 = 1, +24 = self, +40 = self, +44 = 6
const records = [];
for (let i = 0; i + 60 < buf.length; i += 4) {
  if (buf.readUInt32LE(i+8) !== 100) continue;
  if (buf.readUInt32LE(i+12) !== 1) continue;
  if (buf.readUInt32LE(i+24) !== i+24) continue;
  if (buf.readUInt32LE(i+40) !== i+40) continue;
  const v44 = buf.readUInt32LE(i+44);
  if (v44 !== 6 && v44 !== 8) continue;
  const regions = buf.readUInt32LE(i+48);
  if (regions > 200) continue;
  const treasury = buf.readInt32LE(i);
  records.push({ pos: i, treasury, regions, kind: v44 === 6 ? 'major' : 'minor' });
}
console.log('faction records:', records.length);
for (const r of records.slice(0, 10)) {
  console.log(' [' + r.kind + '] 0x' + r.pos.toString(16), 'treasury:', r.treasury, 'regions:', r.regions);
}

// Macedon major @ 0x3dcc3 in T97. Walk its trailing data and look for clusters of
// records with (turn, X, Y, faction_a, faction_b, casualties) shape.
const player = records[0];
console.log('\nplayer record:', player);
const playerStart = player.pos + 52 + 4 * player.regions;
console.log('player trailing data starts at 0x' + playerStart.toString(16));

// Find next record's start to know end
let nextStart = buf.length;
for (const r of records) {
  if (r.pos > player.pos && r.pos < nextStart) nextStart = r.pos;
}
console.log('player record ends at next record start: 0x' + nextStart.toString(16));
console.log('trailing data size:', nextStart - playerStart, 'bytes');

// Scan player trailing data for fixed-stride records containing (X, Y) pairs
function scanForBattleRecords(start, end, stride, hdrU32s) {
  // Each record candidate at offset i has hdrU32s u32s with at least 2 being valid X, Y
  let recordCount = 0;
  const records = [];
  for (let i = start; i + stride <= end; i += stride) {
    const u32s = [];
    for (let k = 0; k < hdrU32s; k++) u32s.push(buf.readUInt32LE(i + k * 4));
    // Find any valid (X, Y) adjacent pair
    let hasXY = false;
    for (let k = 0; k + 1 < hdrU32s; k++) {
      if (u32s[k] >= 1 && u32s[k] <= 1020 && u32s[k+1] >= 1 && u32s[k+1] <= 700) { hasXY = true; break; }
    }
    if (hasXY) recordCount++;
  }
  return recordCount;
}
// Try various strides
console.log('\nplayer trailing scan for battle-shape records:');
for (const stride of [16, 20, 24, 28, 32, 36, 40, 48, 56, 64]) {
  const cnt = scanForBattleRecords(playerStart, nextStart, stride, Math.floor(stride/4));
  if (cnt > 5) console.log(' stride=' + stride, 'records with X,Y:', cnt, 'of', Math.floor((nextStart-playerStart)/stride));
}

// Dump first 256 bytes of player trailing for inspection
console.log('\nfirst 256 bytes of player trailing:');
for (let i = playerStart; i < playerStart + 256; i += 16) {
  let line = i.toString(16).padStart(8, '0') + ': ';
  for (let j = 0; j < 16; j++) line += buf[i+j].toString(16).padStart(2, '0') + ' ';
  line += ' | ';
  for (let j = 0; j < 16; j++) line += (buf[i+j] >= 32 && buf[i+j] < 127) ? String.fromCharCode(buf[i+j]) : '.';
  console.log(line);
}
