// Understand RIS settlement record structure. In macedon t0, names are NOT
// immediately before default_set. Find where settlement names live and what the
// stats block looks like. Anchor: search for a known settlement name as UTF-16
// pstr16 and dump bytes around it + the nearest default_set after it.
//
// Read-only.

const fs = require('fs');
const path = require('path');
const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const buf = fs.readFileSync(path.join(SAVE_DIR, 'save_macedon t0.sav'));

function utf16PstrPositions(buf, name) {
  // Build [u16 len][UTF-16 name] and find all positions of the prefix.
  const len = name.length;
  const t = Buffer.alloc(2 + len * 2);
  t.writeUInt16LE(len, 0);
  for (let i = 0; i < len; i++) t.writeUInt16LE(name.charCodeAt(i), 2 + i * 2);
  const out = []; let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { out.push(p); p++; }
  return out;
}

function hex(off, n) {
  return Array.from(buf.slice(off, off + n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

for (const name of ['Pella', 'Sparta', 'Athens']) {
  const positions = utf16PstrPositions(buf, name);
  console.log(`\n##### ${name}: ${positions.length} pstr16 occurrences #####`);
  for (const pos of positions.slice(0, 6)) {
    const nameEnd = pos + 2 + name.length * 2;
    // find next default_set within 4KB
    const ds = buf.indexOf(Buffer.from('default_set', 'ascii'), nameEnd);
    const dsDist = (ds >= 0) ? ds - nameEnd : -1;
    console.log(`  @0x${pos.toString(16)}  nameEnd=0x${nameEnd.toString(16)}  nextDefSet=+${dsDist}`);
  }
  // For the occurrence whose next default_set is closest (likely the settlement
  // record), dump the surrounding stats.
  let best = null, bestDist = Infinity;
  for (const pos of positions) {
    const nameEnd = pos + 2 + name.length * 2;
    const ds = buf.indexOf(Buffer.from('default_set', 'ascii'), nameEnd);
    if (ds < 0) continue;
    const d = ds - nameEnd;
    if (d >= 0 && d < bestDist) { bestDist = d; best = pos; }
  }
  if (best != null) {
    console.log(`  >>> closest-defset occurrence @0x${best.toString(16)} (defset +${bestDist})`);
    // dump u32 fields from dx -700..+40
    const np = best;
    const found = [];
    for (let dx = -700; dx <= 40; dx++) {
      const o = np + dx;
      if (o < 0 || o + 4 > buf.length) continue;
      const v = buf.readUInt32LE(o);
      if (v >= 1 && v <= 40000) found.push(`[${dx}]=${v}`);
    }
    // print in chunks
    for (let i = 0; i < found.length; i += 12) console.log('     ' + found.slice(i, i + 12).join(' '));
  }
}
