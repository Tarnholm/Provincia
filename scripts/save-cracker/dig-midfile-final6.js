// Session 27 — Validate diagonal pattern in OTHER saves (RoR T1, other rome saves)
// If the diagonal is a fixed engine construct, it should appear identically in any save.

const fs = require('fs');

function scanMidFile(savPath) {
  if (!fs.existsSync(savPath)) return null;
  const buf = fs.readFileSync(savPath);

  // Find ARR_START by scanning for the canonical pattern (5, 0, 0, 10, 200, 200, 2, 6, 200)
  // Pattern: bytes [05 00 00 00 00 00 00 00 00 00 00 00 0a 00 00 00 c8 00 00 00 c8 00 00 00 02 00 00 00 06 00 00 00 c8 00 00 00]
  const pattern = Buffer.from('0500000000000000000000000a000000c8000000c8000000020000000600000000', 'hex'); // most of it
  let arrStart = -1;
  for (let off = 0x10000; off < Math.min(buf.length, 0x1000000); off += 1) {
    let m = true;
    for (let j = 0; j < pattern.length; j++) {
      if (buf[off+j] !== pattern[j]) { m = false; break; }
    }
    if (m) { arrStart = off; break; }
  }
  if (arrStart < 0) return null;

  const STRIDE = 267;
  const W = 240, H = 238;

  let count600 = 0;
  let diag237 = 0;
  let lastRow = 0;
  const cells = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const o = arrStart + (r*W + c)*STRIDE;
      if (o + 36 > buf.length) break;
      const f28 = buf.readUInt32LE(o + 28);
      const f32 = buf.readUInt32LE(o + 32);
      if (f28 === 6 && f32 === 600) {
        count600++;
        if (c + r === 237) diag237++;
        if (r === 237) lastRow++;
        cells.push({c, r});
      }
    }
  }

  return {savPath, arrStart, count600, diag237, lastRow, cells};
}

const saves = [
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav',
];

for (const sav of saves) {
  console.log('\n=== ' + sav.split('/').pop() + ' ===');
  const r = scanMidFile(sav);
  if (r) {
    console.log('  arrStart: 0x' + r.arrStart.toString(16));
    console.log('  f32=600 cells total:', r.count600);
    console.log('  on c+r=237 diag:', r.diag237);
    console.log('  on bottom row r=237:', r.lastRow);
    // Show first 10 diag cells
    const diagCells = r.cells.filter(c=>c.c+c.r === 237);
    console.log('  Sample diag cells:', diagCells.slice(0,5).map(c=>'('+c.c+','+c.r+')').join(','));
  } else {
    console.log('  Could not find array');
  }
}

// Also check archive T1
const archive = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const files = require('fs').readdirSync(archive).filter(f=>f.endsWith('.sav')).slice(0,3);
for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const r = scanMidFile(archive + f);
  if (r) {
    console.log('  arrStart: 0x' + r.arrStart.toString(16));
    console.log('  f32=600 cells total:', r.count600);
    console.log('  on c+r=237 diag:', r.diag237);
    console.log('  on bottom row r=237:', r.lastRow);
  } else {
    console.log('  Could not find array');
  }
}
