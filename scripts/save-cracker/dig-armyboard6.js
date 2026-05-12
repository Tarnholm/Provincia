// dig-armyboard6.js — count and identify the 138B in the tail
// by computing the Lua pointer table size in each save

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// The Lua pointer-table is at around 0x02110e2c.
// Each entry looks like:
//   - "0x6b 0x0e 0x11 0x02 0x00 0x00" — 6-byte entry (ptr + u16 zero)
//   - or "0x01 0x00 0x1d 0x01 0x00 0x00 0xa9 0x01 0x00 0x00" — 10-byte (some flag + 2 ptrs)
// Let me scan and tabulate.

function scanLuaPtrTable(buf, start, end) {
  const entries = [];
  let i = start;
  while (i < end) {
    // Heuristic: look for an entry boundary
    // The pattern is (u32 LE pointer in range 0x02110000..0x02120000) followed by (u16 zero or flag)
    const u32 = buf.readUInt32LE(i);
    if (u32 >= 0x02110000 && u32 < 0x02120000) {
      // Pointer entry
      // Read trailing u16
      const u16 = buf.readUInt16LE(i + 4);
      // If u16 == 0x0001, it's a 10-byte entry with 4-byte data after
      if (u16 === 0x0001) {
        entries.push({ off: i, type: '10B', ptr: u32, val1: buf.readUInt32LE(i + 6) });
        i += 10;
      } else if (u16 === 0x0002) {
        entries.push({ off: i, type: '14B', ptr: u32, val1: buf.readUInt32LE(i + 6), val2: buf.readUInt32LE(i + 10) });
        i += 14;
      } else {
        entries.push({ off: i, type: '6B', ptr: u32 });
        i += 6;
      }
    } else {
      // Maybe we're misaligned; stop.
      break;
    }
  }
  return entries;
}

const lo = 0x02110e2c;
const hi = 0x02115800;

const aEntries = scanLuaPtrTable(A, lo, hi);
const bEntries = scanLuaPtrTable(B, lo, hi + 200);

console.log(`A entries: ${aEntries.length}`);
console.log(`B entries: ${bEntries.length}`);

// Tabulate by type
const aType = {};
const bType = {};
for (const e of aEntries) aType[e.type] = (aType[e.type] || 0) + 1;
for (const e of bEntries) bType[e.type] = (bType[e.type] || 0) + 1;
console.log(`A types: ${JSON.stringify(aType)}`);
console.log(`B types: ${JSON.stringify(bType)}`);

// Total sizes
const aSize = aEntries.reduce((s, e) => s + (e.type === '6B' ? 6 : e.type === '10B' ? 10 : 14), 0);
const bSize = bEntries.reduce((s, e) => s + (e.type === '6B' ? 6 : e.type === '10B' ? 10 : 14), 0);
console.log(`A table size: ${aSize}B  B table size: ${bSize}B  delta: ${bSize - aSize}`);

// Show first 20 entries of A and B
console.log('\nA first 30 entries:');
for (const e of aEntries.slice(0, 30)) {
  console.log(`  ${hex(e.off)}: ${e.type} ptr=${hex(e.ptr)} val1=${e.val1} val2=${e.val2}`);
}
console.log('\nB first 30 entries:');
for (const e of bEntries.slice(0, 30)) {
  console.log(`  ${hex(e.off)}: ${e.type} ptr=${hex(e.ptr)} val1=${e.val1} val2=${e.val2}`);
}
