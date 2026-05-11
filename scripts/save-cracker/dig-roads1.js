// Roads - approach 1: look for a global tile-level road adjacency map.
// RTW needs tile-pair edges to compute trade routes / pathfinding through roads.
// The save's main fixed-size grids are:
//  - 9.78MB mid-file (240x238 records, 267-byte stride)
//  - 1.86MB tail (239 per-faction 1020x700 RLE masks)
// A tile-level road graph would be ~1020*700 bytes = 700KB if u8 per tile.

// Method:
// 1) Look for areas of the save whose byte values are sparse 0/1/2/3
//    AND positioned in a 700KB+ block that could hold a per-tile road code.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

// Find areas where byte histogram is dominated by 0/few small values
function blockEntropy(start, end) {
  const histogram = new Array(256).fill(0);
  for (let i = start; i < Math.min(end, buf.length); i++) histogram[buf[i]]++;
  return histogram;
}

// Scan in 1MB blocks; report the dominant byte values
console.log('Byte histogram per 1MB block:');
for (let mb = 0; mb < Math.floor(buf.length / (1024*1024)); mb++) {
  const start = mb * 1024*1024;
  const end = (mb+1) * 1024*1024;
  const h = blockEntropy(start, end);
  // Find top 3 non-zero bytes
  const sorted = h.map((c, i) => ({c, i})).sort((a,b) => b.c - a.c).slice(0, 5);
  console.log('mb', mb, 'starts 0x' + start.toString(16), 'top:', sorted.map(s => 'b'+s.i.toString(16).padStart(2,'0')+':'+s.c).join(' '));
}

// Look for HST entries with "ROAD" or "PATHFINDING" or "WORLDMAP"
console.log('\nLooking for HST entries:');
const HST_START = 0x3000;
const HST_END = 0x4000;
let pos = HST_START;
const hstEntries = [];
while (pos < HST_END) {
  // ASCIIZ name
  const startName = pos;
  while (pos < HST_END && buf[pos] !== 0) pos++;
  if (pos >= HST_END) break;
  const name = buf.slice(startName, pos).toString('utf8');
  pos++; // skip nul
  // u32 version
  if (pos + 4 > HST_END) break;
  const v = buf.readUInt32LE(pos);
  pos += 4;
  hstEntries.push({ name, v });
  if (name === '') break;
}
console.log('HST count:', hstEntries.length);
// Filter for road-related
const roadEntries = hstEntries.filter(e => /ROAD|PATH|MAP|TILE|TERRA|TRADE/i.test(e.name));
console.log('Road/Path/Map/Tile/Trade HST entries:');
for (const e of roadEntries) console.log(' ', e.name, 'v=' + e.v);
