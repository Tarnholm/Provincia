// Settlement-owner table at 0x1190 has faction-id at +4 of each 12-byte entry,
// in sorted order from 3 to 19. The +0 field (11.5M-12.7M range) might be
// packed tile coordinates.
//
// Goal: identify which faction-id maps to which faction name. Approach:
// 1. Spain has 4 known settlements: Carthago_Nova, Corduba, Numantia, Asturica
// 2. Find the faction-id with exactly those 4 settlements (using +0 coords)
// 3. The +0 value should match per-settlement coordinates

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Read all 12-byte entries at 0x1190..0x14a0
const entries = [];
for (let off = 0x1190; off < 0x14a0; off += 12) {
  if (off + 12 > peace.length) break;
  const packed = peace.readUInt32LE(off);
  const facId = peace.readUInt32LE(off + 4);
  const owner = peace.readUInt32LE(off + 8);
  if (facId > 30) break;
  entries.push({ off, packed, facId, owner });
}

// Group by faction-id
const byFac = {};
for (const e of entries) {
  if (!byFac[e.facId]) byFac[e.facId] = [];
  byFac[e.facId].push(e);
}

// Try to decode the packed coordinate field. Common packings:
// (Y << 16) | X     — y_high, x_low
// (X << 16) | Y     — x_high, y_low
// 3 bytes XYZ
// fixed-point coords (×256)
console.log('=== All entries with multiple coord decodings ===');
for (const facId of Object.keys(byFac).sort((a, b) => parseInt(a) - parseInt(b))) {
  console.log('\n--- faction-id ' + facId + ' (' + byFac[facId].length + ' settlements) ---');
  for (const e of byFac[facId]) {
    const v = e.packed;
    const lo16 = v & 0xffff;
    const hi16 = (v >>> 16) & 0xffff;
    const b0 = v & 0xff;
    const b1 = (v >>> 8) & 0xff;
    const b2 = (v >>> 16) & 0xff;
    const b3 = (v >>> 24) & 0xff;
    console.log('  ' + String(v).padStart(9) + ' = 0x' + v.toString(16).padStart(8, '0') +
      '  hi16=' + hi16 + ' lo16=' + lo16 +
      '  bytes=[' + b0 + ',' + b1 + ',' + b2 + ',' + b3 + ']');
  }
}

// In vanilla RTW 270 BC, Spain's settlement coordinates (from descr_strat):
//   Carthago_Nova: ~ (27, 68)
//   Corduba: ~ (28, 60)
//   Numantia: ~ (33, 76)
//   Asturica: ~ (30, 82)
// Roman Julii settlements (for comparison):
//   Arretium: (108, 112)
//   Ariminum: (123, 116)
//   Patavium: (128, 132)

// If the coord is packed bytes [x_lo, x_hi, y_lo, y_hi], we'd see:
//   Carthago_Nova = [27, 0, 68, 0]  → packed = 27 | (68 << 16) = 4456475
//   Spain entries would be in low-x range (27-33)

// Look for any entry where byte0 is in 25-35 range (Spain) or 108-130 (Italy)
console.log('\n=== Look for Spain-coord matches (byte0 in 25..35) ===');
const spainCandidates = entries.filter(e => {
  const b0 = e.packed & 0xff;
  const b2 = (e.packed >>> 16) & 0xff;
  return (b0 >= 25 && b0 <= 35) || (b2 >= 25 && b2 <= 35);
});
for (const c of spainCandidates) {
  console.log('  facId=' + c.facId + ' packed=' + c.packed +
    ' bytes=[' + (c.packed & 0xff) + ',' + ((c.packed>>>8)&0xff) + ',' +
    ((c.packed>>>16)&0xff) + ',' + ((c.packed>>>24)&0xff) + ']');
}
