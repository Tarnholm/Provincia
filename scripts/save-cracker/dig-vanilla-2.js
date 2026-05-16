// Look for major-faction records in vanilla Rome with relaxed conditions.
// Spain should be one of the playable factions; check for treasury-like
// records.

const fs = require('fs');

const PATH = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_17-05-2026   Spain   Turn 1.sav';
const buf = fs.readFileSync(PATH);

// First: count occurrences of u32 == 100 at any offset
let count100 = 0;
const positions = [];
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf.readUInt32LE(i) === 100) {
    count100++;
    if (positions.length < 20) positions.push(i);
  }
}
console.log('Total u32 == 100 anywhere: ' + count100);
console.log('First 20 positions:', positions.map(p => '0x' + p.toString(16)).join(', '));

// Search the FIRST few candidate u32=100 positions for treasury-like context.
// In RIS, major records start with i32 treasury at +0, then class=100 at +8.
// So look at u32@+8=100, then check u32@-8 is a plausible treasury value
console.log('\n=== Candidate major records (u32@+8=100, check structure) ===');
let candidates = 0;
for (let i = 0; i + 64 < buf.length; i++) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  const treasury = buf.readInt32LE(i);
  const v12 = buf.readUInt32LE(i + 12);
  const v24 = buf.readUInt32LE(i + 24);
  const v40 = buf.readUInt32LE(i + 40);
  const v44 = buf.readUInt32LE(i + 44);
  const v48 = buf.readUInt32LE(i + 48);
  // Print first few
  if (candidates < 10) {
    console.log('  pos=0x' + i.toString(16) + '  treasury=' + treasury + '  v12=' + v12 + '  v24=0x' + v24.toString(16) + '  v40=0x' + v40.toString(16) + '  v44=' + v44 + '  v48=' + v48);
  }
  candidates++;
}
console.log('Total candidates (u32@+8=100):', candidates);

// Try the RELAXED treasury record finder: just look for self-pointer at +24
// (without requiring class=100). Vanilla Rome major records might not have
// the class tag at +8.
console.log('\n=== Self-pointer at +24 records (ANY class tag) ===');
let selfPtrRecs = 0;
const selfPtrSamples = [];
for (let i = 24; i + 64 < buf.length; i++) {
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 44) !== 6) continue;
  const regions = buf.readUInt32LE(i + 48);
  if (regions > 200) continue;
  selfPtrRecs++;
  if (selfPtrSamples.length < 30) selfPtrSamples.push({
    pos: i,
    treasury: buf.readInt32LE(i),
    v8: buf.readUInt32LE(i + 8),
    v12: buf.readUInt32LE(i + 12),
    regions,
  });
  i = Math.min(buf.length - 64, i + 92 + 4 * regions);
}
console.log('Total self-ptr+ +24/+40/+44=6 records:', selfPtrRecs);
console.log('Samples:');
for (const r of selfPtrSamples) {
  console.log('  pos=0x' + r.pos.toString(16) + '  treasury=' + r.treasury + '  v8=' + r.v8 + '  v12=' + r.v12 + '  regions=' + r.regions);
}

// Look for "spain" ASCII context (probably a faction-tag region)
const spainAsc = buf.indexOf(Buffer.from('spain'));
console.log('\n=== Context around first "spain" ASCII (0x' + spainAsc.toString(16) + ') ===');
function dump(off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + asc);
  }
}
if (spainAsc > 0) dump(spainAsc - 32, 128);

// Count occurrences of "spain" (faction tag prefix)
let spainCount = 0;
let p = 0;
while ((p = buf.indexOf(Buffer.from('spain'), p)) !== -1) { spainCount++; p++; if (spainCount > 100) break; }
console.log('\nTotal "spain" ASCII occurrences (cap 100):', spainCount);

// Find all faction-name ASCII strings (low-level faction tags)
const factionNames = ['romans_julii', 'romans_brutii', 'romans_scipii', 'romans_senate',
  'macedon', 'greek_cities', 'thrace', 'dacia', 'scythia', 'parthia', 'pontus',
  'armenia', 'seleucid', 'egypt', 'numidia', 'carthage', 'spain', 'gauls',
  'britons', 'germans', 'slave'];
console.log('\n=== Faction-tag ASCII counts ===');
for (const n of factionNames) {
  let c = 0;
  let q = 0;
  const needle = Buffer.from(n);
  while ((q = buf.indexOf(needle, q)) !== -1) { c++; q++; if (c > 50) break; }
  if (c > 0) console.log('  "' + n + '": ' + c);
}
