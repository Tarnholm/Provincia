// Hunt for faction definitions in the save. RTW typically stores faction
// metadata as `<u32 something><pstr16-ASCII faction_name><...>`. Search for
// the faction names from descr_sm_factions.

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

// Faction names known to be in this campaign (from class strings in metadata records).
const FACTIONS = [
  'roman', 'greek', 'seleucid', 'armoured_sarmatian', 'northern_illyrian',
  'nabataean', 'kushite', 'campanian', 'picentine', 'prienian',
  'galatian', 'antigonid', 'aitolian', 'athenian', 'cappadocian',
  'cyrene', 'knossian', 'lyttian', 'massaliote_foot', 'paphlagonian',
  'spartan', 'etruscan', 'antigonid',
];

console.log('=== Locate each faction name string in the save (and dump surrounding bytes) ===\n');

for (const facName of FACTIONS) {
  const needle = Buffer.from(facName, 'ascii');
  const hits = [];
  let p = 0;
  while ((p = A.indexOf(needle, p)) !== -1) {
    // Check this isn't a substring (preceded by alpha char) and is followed
    // by null or non-alpha (so it's a full word).
    const before = p > 0 ? A[p - 1] : 0;
    const after = A[p + needle.length];
    const isWordStart = before < 0x41 || before > 0x7a || (before >= 0x5b && before <= 0x60);
    const isWordEnd = after === 0 || after < 0x21 || after > 0x7e;
    if (isWordStart && isWordEnd) {
      hits.push(p);
    }
    p++;
  }
  if (hits.length === 0) {
    console.log(facName.padEnd(28) + ' NOT FOUND');
    continue;
  }
  console.log(facName.padEnd(28) + 'hits: ' + hits.length + (hits.length <= 3 ? '' : ' (showing first 3)') + '   first @ 0x' + hits[0].toString(16));
  // Dump context around first 2 hits
  for (let h = 0; h < Math.min(2, hits.length); h++) {
    const off = hits[h];
    console.log('    @ 0x' + off.toString(16) + ':');
    // 32 bytes before, 32 bytes after
    const startB = Math.max(0, off - 16);
    const endB = Math.min(A.length, off + needle.length + 16);
    for (let oo = startB; oo < endB; oo += 16) {
      const bytes = A.subarray(oo, Math.min(oo + 16, A.length));
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const asc = Array.from(bytes).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
      const mark = (oo <= off && off < oo + 16) ? ' <-- here' : '';
      console.log('      0x' + oo.toString(16).padStart(7, '0') + ': ' + hex.padEnd(48) + '  ' + asc + mark);
    }
  }
}
