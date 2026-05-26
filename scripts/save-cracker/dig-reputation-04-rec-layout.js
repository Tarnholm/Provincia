// dig-reputation-04-rec-layout.js
// Dump the raw header bytes of vanilla class-100 records to understand the
// actual layout (RIS offsets give garbage). Goal: find a per-faction STABLE
// identity field (faction id or uuid) so we can track the same faction's
// record across turns, and find where regionCount / region list really sits.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

function findRecs(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    out.push(i);
  }
  return out;
}

const recs = findRecs(buf);
console.log('records=' + recs.length);

// Dump first 3 records' first 80 bytes as u32 columns (relative offsets).
for (let r = 0; r < 3; r++) {
  const i = recs[r];
  console.log(`\n=== record ${r} @0x${i.toString(16)} treasury=${buf.readInt32LE(i)} ===`);
  for (let off = 0; off < 96; off += 4) {
    const v = buf.readUInt32LE(i + off);
    const rel = (v >= i - 16 && v <= i + 256) ? `  (=rec+${v - i})` : '';
    console.log(`  +${String(off).padStart(3)}: ${String(v).padStart(12)}  0x${v.toString(16).padStart(8,'0')}${rel}`);
  }
  // raw bytes 44..96 too
  const raw = Array.from(buf.slice(i + 44, i + 96)).map(b => b.toString(16).padStart(2,'0')).join(' ');
  console.log('  bytes +44..+96: ' + raw);
}
