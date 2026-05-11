// dig-tilemap12.js — figure out the FULL byte layout of one canonical record (97 bytes)
// Canonical record reads as:
//   u32+0  = 5    (constant: 'item type code'?)
//   u32+4  = 0
//   u32+8  = 0
//   u32+12 = 10   (constant)
//   u32+16 = 200  (constant: 'max value' = 200, like morale cap?)
//   u32+20 = 200  (sometimes 600 or 0)
//   u32+24 = 2    (constant: 'class'?)
//   u32+28 = 6    (sometimes 54 (0x36), 55 (0x37))
//   u32+32 = 200  (sometimes 600 or 0 or -10)
//   u32+36..64 = 0  (zero block)
//   u32+68 = 3    (constant)
//   u32+72..80 = 0
//   u32+84 = 576 (0x240 = 2*256 + 64, or interpret 84-87 = bytes [0x40, 0x02, 0x00, 0x00] = u16(64) + u16(2)?)
//   u32+88..92 = 0
//   u32+96 = 166 (0xa6, constant)
// total = 100 bytes used (offsets 0..99) but cluster len = 97

// Let me check if interpreting as u16/i32 gives saner values

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const GAP_START = 0x633bb3;
const STRIDE = 267;
const FIRST_REC_OFF = GAP_START + 157;

// Dump record 0 in multiple interpretations
const base = FIRST_REC_OFF;
console.log('Record 0 byte-by-byte:');
for(let i=0;i<100;i++){
  process.stdout.write(buf[base+i].toString(16).padStart(2,'0'));
  if((i+1)%4===0) process.stdout.write(' ');
}
console.log();

// Try u16le interpretation
console.log('\nAs u16le:');
for(let i=0;i<50;i++){
  const v = buf.readUInt16LE(base + i*2);
  if(v !== 0) console.log('  u16 +' + (i*2).toString().padStart(2) + ': ' + v + ' (0x' + v.toString(16) + ')');
}

// Try i32 (signed) interpretation
console.log('\nAs i32 (signed) for canonical record:');
for(let i=0;i<25;i++){
  const v = buf.readInt32LE(base + i*4);
  if(v !== 0) console.log('  i32 +' + (i*4).toString().padStart(2) + ': ' + v);
}

// Try f32
console.log('\nAs f32 (canonical record 0):');
for(let i=0;i<25;i++){
  const v = buf.readFloatLE(base + i*4);
  if(v !== 0 && !isNaN(v) && isFinite(v)) console.log('  f32 +' + (i*4).toString().padStart(2) + ': ' + v);
}

// One more: maybe this is a list of TRADE-RESOURCE records.
// Recall: descr_strat has 688 'resource' entries. Each resource has a name and a coord.
// What if the array is per-tile, with most tiles unused (canonical=empty), and the 250 +28=54 are resources?
// 36582 records — way bigger than 688 resources. So not directly that.

// But maybe each record is a per-tile-CLASS-X record (e.g., per ground-type tile)
// Vanilla map_ground_types.tga decides the texture per tile.
// Or this could be the WATCHTOWERS / forts / various map placement objects.

// Let me look at HST types and see which one is plausible
// HST entry "GROUND_TILE v=1" — maybe one record per ground-tile (terrain texture sample)
// 36582 ground tiles... matches ~size of 255*156 map without sea (29335 land) — still off

// Or HST entry 'AMBIENT_OBJECT v=1' — ambient objects: trees, rocks, ruins on the map?
// Or 'CAMPAIGN_AI v=?' — not in HST
// Or 'WORLD_MAP_STREAMING_GAME_TILE v=1' — said in session 12

// Looking at it more carefully — value 200 (0xc8) appears 3 times. In RTW:
// - 200 is the "neutral" starting diplomatic attitude (per descr_strat)
// - 200 is often the default attack value
// - Cities have population 200..50000+

// Value 5 at +0, value 10 at +12, value 2 at +24, value 6 at +28, value 3 at +68 — these look like
// small fixed enum values.
// Value 576 at +84 — could be a 'building chain id'?
// Value 166 at +96 — could be 'unit type id'?

// Hypothesis: This is the per-(faction/region) STARTING ARMY composition? Each faction has soldiers,
// each soldier has stats. 21 factions * starting armies ~= 1742 records per faction... 21*1742=36582!
// 36582 / 21 = 1742. So WHAT in RTW has 1742 units per faction?
// Actually no — total army units across the corpus is 535 (per 'unit' word count in descr_strat).
// So not units.

// Maybe per-resource-on-map records? 688 * something. 36582 / 688 = 53.17. Not clean.

// Let me check: is this the WATCHTOWER / FORT cache? Vanilla has none placed by default but
// the engine may pre-allocate.
// Or maybe FIDDLE STICKS — let me check if 36582 = 2 * 3 * 7 * 13 * 67 maps to anything else
// 36582 / 67 = 546
// 546 / 6 = 91; 91 = 7*13
// 36582 / 91 = 402 ?
// Trying: 199 (regions) * ?
console.log('\n36582 / 21 =', 36582/21);
console.log('36582 / 199 =', 36582/199);
console.log('36582 / 96 =', 36582/96); // 96 = settlement count in descr_strat
console.log('36582 / 177 =', 36582/177); // 177 = character count
console.log('36582 / 688 =', 36582/688);
console.log('36582 / 535 =', 36582/535); // 535 = unit count
