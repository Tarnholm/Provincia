// Confirm the per-character "tile-seen" list at 0x1504eb9: +32 bytes ADDED
// of 4 entries [u32=1][u32=tileID]. Compare more broadly.
//
// Also check the Lua-state mention "ThessalyRebellion_AllAntigonidOwned2" at
// 0x20e8240 — this is a Lua script string. Why does it appear in save_4.2 but
// not save_1.2 or save_3.2? Could be that the diplomat triggered a script
// event by entering certain region.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const buf1 = fs.readFileSync(path.join(SAVE_DIR, 'save_1.2.sav'));
const buf3 = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));
const buf4 = fs.readFileSync(path.join(SAVE_DIR, 'save_4.2.sav'));

const NEEDLE = Buffer.from('T\0h\0e\0s\0s\0a\0l\0y\0R\0e\0b\0e\0l\0l\0i\0o\0n\0', 'binary');
for (const [name, buf] of [['save_1', buf1], ['save_3', buf3], ['save_4', buf4]]) {
  const idx = buf.indexOf(NEEDLE);
  console.log(`${name}: 'ThessalyRebellion' at ${idx === -1 ? 'NOT FOUND' : '0x'+idx.toString(16)}`);
  if (idx !== -1) {
    // dump surrounding
    console.log('    Context:');
    for (let p = idx - 16; p < idx + 96; p += 16) {
      const slice = buf.slice(p, p+16);
      const hex = Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' ');
      const asc = Array.from(slice).map(x => (x>=0x20 && x<0x7f) ? String.fromCharCode(x) : '.').join('');
      console.log(`      0x${p.toString(16)}: ${hex.padEnd(48)} | ${asc}`);
    }
  }
}

// Now check the tile-seen entries at 0x1504eb9 in save_4.2.
// Are tile IDs 229, 3759, 193, 3833 special? Let me see what the existing
// entries are in save_1.2 vs save_4.2 immediately before the portrait.
console.log('\nTile-seen list entries (immediately before 284.tga portrait):');
function getEntries(buf) {
  const portrait = Buffer.from('data/ui/roman/portraits/cards/young/generals/284.tga');
  const portraitOff = buf.indexOf(portrait);
  // The structure is `[u32 a][u32 b]` repeated until we hit a `[u8 strLen][string]`
  // Working backward from portraitOff, find the [u16 strLen=0x35] for the portrait.
  // That's at portraitOff - 2. Before that is end-of-list 00 00 (or similar).
  // Walk backwards by 8 collecting [u32, u32] pairs.
  const out = [];
  let p = portraitOff - 4;
  // skip backwards while we see 0x00 padding (the list length marker is 2 bytes)
  // Actually portrait[length-prefix] is at portrait_off - 2 (u16 LE = 0x35 = 53).
  // Before that is 1 zero byte and a "list end" marker.
  p = portraitOff - 4 - 2; // first u32 of last entry's value
  for (let i = 0; i < 30; i++) {
    if (p - 8 < 0) break;
    const b = buf.readUInt32LE(p);
    const a = buf.readUInt32LE(p - 4);
    if (a === 0 && b === 0) break;
    if (a > 100000) break;
    out.unshift([a, b]);
    p -= 8;
  }
  return out;
}

console.log(`save_1 entries: ${JSON.stringify(getEntries(buf1))}`);
console.log(`save_3 entries: ${JSON.stringify(getEntries(buf3))}`);
console.log(`save_4 entries: ${JSON.stringify(getEntries(buf4))}`);
