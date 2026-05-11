// Decode the hinterland_roads sub-record payload to find road LEVEL.
// Each settlement's hinterland_roads occurrence has a payload after the name.
// Standard sub-record shape: [u32 selfPtr][u16 nameLen+1][asciiz name][payload]
// From the hex dump:
// at 0xf85194: 94 51 f8 00 (selfPtr=0xf85194) 11 00 (nameLen=17) "hinterland_roads\0" then payload
// at 0xf851ab: 8f 4d 08 99 01 00 00 00 00... payload

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

// Find all hinterland_roads occurrences (which is 17 chars including a length prefix)
const tok = Buffer.from('hinterland_roads\0');
const recs = [];
let p = 0;
while ((p = buf.indexOf(tok, p)) !== -1) {
  // payload starts at p + 17
  // The sub-record's selfPtr is at p - 6 (u32) and the nameLen u16 at p - 2
  const namePos = p;
  const sp = buf.readUInt32LE(p - 6);
  const ln = buf.readUInt16LE(p - 2);
  recs.push({ namePos, sp, nameLen: ln });
  p++;
}
console.log('total hinterland_roads:', recs.length);
console.log('first 5:');
for (const r of recs.slice(0, 5)) {
  console.log(' name @', '0x' + r.namePos.toString(16), 'selfPtr=' + r.sp.toString(16), 'expected:', (r.namePos-6).toString(16), 'nameLen=' + r.nameLen);
}

// Now: get the payload of each. Payload starts at namePos+17 ("\\0" is included in the 17 length)
// What's in the payload? Let's look at first 24 bytes after the name
console.log('\nPayload distribution (first 24 bytes after name):');
const pld = new Map();
for (const r of recs) {
  const pos = r.namePos + 17;
  const slice = buf.slice(pos, pos + 24).toString('hex');
  pld.set(slice, (pld.get(slice) || 0) + 1);
}
// Print top unique payloads
const sortedPld = [...pld.entries()].sort((a,b) => b[1] - a[1]).slice(0, 20);
for (const [k, c] of sortedPld) console.log(' c=' + c, k);

// Look at specific bytes at relative offsets
// Each hinterland_roads sub-record has a "level" byte somewhere
// Try common offsets: +5 (after 4-byte runtime hash), +9, +13, etc.
console.log('\nByte distributions at fixed offsets (payload+T):');
for (const T of [0, 4, 5, 8, 12, 16, 20, 24, 28, 32]) {
  const dist = {};
  for (const r of recs) {
    const v = buf[r.namePos + 17 + T];
    dist[v] = (dist[v] || 0) + 1;
  }
  const top = Object.entries(dist).sort((a,b) => b[1] - a[1]).slice(0, 6);
  console.log(' T=' + T + ':', top.map(([k,c]) => 'b' + parseInt(k).toString(16).padStart(2,'0') + ':' + c).join(' '));
}

// Check the +8/+9 area for the "level" field
console.log('\nByte 5 after name (in 539 hinterland_roads records):');
const lvlDist = {};
for (const r of recs) {
  const v = buf[r.namePos + 17 + 5];
  lvlDist[v] = (lvlDist[v] || 0) + 1;
}
console.log(lvlDist);

// Also look at byte 4 (= u32+4) which often holds "level" in building chain sub-records
// (per session 10's "+4 byte after runtime hash = current level")
console.log('\nByte 4 (level byte per session 10 schema):');
const lvl4Dist = {};
for (const r of recs) {
  const v = buf[r.namePos + 17 + 4]; // payload + 4
  lvl4Dist[v] = (lvl4Dist[v] || 0) + 1;
}
console.log(lvl4Dist);

// look at u32 +24 (building health from session 11/17)
console.log('\nByte at payload + 0x28 (building HP per session 17):');
const hpDist = {};
for (const r of recs) {
  const v = buf.readUInt32LE(r.namePos + 17 + 0x28);
  hpDist[v] = (hpDist[v] || 0) + 1;
}
console.log(hpDist);
