// Final attempt: each diplomatic block is mixed into the settlement-plan zone.
// Find the SETTLEMENT NAME (UTF-16) that precedes each block's first record.
// That settlement is owned by the block's faction.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

const PREAMBLE = Buffer.from([
  0x08, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x0d, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
]);

function findAllRecords(buf) {
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(PREAMBLE, p)) !== -1) {
    const aOff = p + 20;
    if (aOff + 16 > buf.length) { p++; continue; }
    const v = buf.readInt32LE(aOff);
    if ([0, 100, 200, 400, 600, -10].includes(v)) hits.push({ recordAt: aOff, preambleAt: p });
    p++;
  }
  return hits;
}

const records = findAllRecords(peace);
const BLOCK_SIZE = 19;
const NUM_BLOCKS = 20;

// For each block's FIRST record, walk back to find a UTF-16 pstr16 settlement name
function findPstr16UTF16Before(buf, off, maxBack = 0x600) {
  const start = Math.max(0, off - maxBack);
  // Scan backward for a UTF-16 pstr16 (u16 strlen + UTF-16 chars + null)
  const candidates = [];
  for (let p = start; p < off; p++) {
    const len = buf.readUInt16LE(p);
    if (len < 3 || len > 30) continue;
    if (p + 2 + len * 2 > buf.length) continue;
    const chars = [];
    let ok = true;
    for (let i = 0; i < len; i++) {
      const c = buf.readUInt16LE(p + 2 + i * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      chars.push(String.fromCharCode(c));
    }
    if (!ok) continue;
    const s = chars.join('');
    if (/^[A-Z][A-Za-z _0-9-]+$/.test(s)) {
      candidates.push({ off: p, str: s, distFromBlock: off - p });
    }
  }
  // Return the closest (smallest distance)
  candidates.sort((a, b) => a.distFromBlock - b.distFromBlock);
  return candidates.slice(0, 3);
}

console.log('=== Settlement names preceding each diplomatic block ===');
for (let b = 0; b < NUM_BLOCKS; b++) {
  const firstRecOff = records[b * BLOCK_SIZE].preambleAt;
  const preceding = findPstr16UTF16Before(peace, firstRecOff);
  console.log('\nBlock ' + b + ' (first record at 0x' + firstRecOff.toString(16) + '):');
  if (preceding.length === 0) {
    console.log('  no UTF-16 settlement name found nearby');
  } else {
    for (const c of preceding) {
      console.log('  "' + c.str + '" at 0x' + c.off.toString(16) + ' (dist=' + c.distFromBlock + ')');
    }
  }
}
