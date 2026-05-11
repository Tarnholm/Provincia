// Search rome10's body for battle-record arrays.
// Each FAMOUS_BATTLE_DETAIL would have: turn, attacker_faction, defender_faction, X, Y, attacker_won, casualties
// Probably 24-32 bytes per record.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

// Body root in rome10 is 0x3b99 size 6488090 per dossier session 12
const root = { off: 0x3b99, sz: 6488090 };
const rootEnd = root.off + root.sz;
let p = root.off + 8;
const kids = [];
while (p + 8 <= rootEnd) {
  const sp = buf.readUInt32LE(p);
  if (sp !== p) { p += 4; continue; }
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 8 || p + sz > rootEnd) { p += 4; continue; }
  kids.push({ off: p, sz });
  p += sz;
}
console.log('body root kids:', kids.length);

// CHARACTER_PATHS-like records should have a structure with X,Y in 1..1500 range.
// Other records would have different shape.

// Look for kids whose payload contains a battle-like signature:
// - turn number (1..200) in early bytes
// - faction IDs (small ints 0..239)
// - X,Y pair (1..1020, 1..700)
// - casualties (small to medium int)
//
// CHARACTER_PATHS payload: u32 size, u32 count, u32 X, u32 Y, then pairs
// A battle-list section might look different

// Classify kids by 'shape':
const sigBuckets = {};
for (const k of kids) {
  // Peek at first 6 u32s of payload
  const u32s = [];
  for (let i = k.off + 8; i + 4 <= k.off + 24 + 4; i += 4) {
    u32s.push(buf.readUInt32LE(i));
  }
  // Make a signature from rough magnitudes
  const sig = u32s.map(u => {
    if (u === 0) return '0';
    if (u < 16) return 's'; // very small
    if (u < 256) return 'b'; // byte-fit
    if (u < 1500) return 't'; // tile-ish
    if (u < 100000) return 'M'; // medium
    return 'L'; // large
  }).join('');
  if (!sigBuckets[sig]) sigBuckets[sig] = [];
  sigBuckets[sig].push(k);
}
console.log('signature buckets:');
for (const sig of Object.keys(sigBuckets).sort((a,b) => sigBuckets[b].length - sigBuckets[a].length).slice(0, 10)) {
  console.log(' ' + sig + ': ' + sigBuckets[sig].length, 'avg size:', (sigBuckets[sig].reduce((a,b) => a+b.sz, 0) / sigBuckets[sig].length).toFixed(0));
}

// Find kids with signature NOT starting with 'M' (the size_field), as char_paths starts with M
const nonCharPaths = kids.filter(k => {
  const sz2 = buf.readUInt32LE(k.off + 8);
  return sz2 < 1000 || sz2 > k.sz;
});
console.log('\nnon-char_paths kids:', nonCharPaths.length);
for (const k of nonCharPaths.slice(0, 15)) {
  console.log(' 0x' + k.off.toString(16), 'size:', k.sz, 'peek:', buf.slice(k.off+8, k.off+48).toString('hex'));
}
