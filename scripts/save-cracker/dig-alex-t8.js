// Use the actual file set: T5 defeat, T7 end, T7 governor, T7 merge,
// T8 start, T8 defeat. Note: autosaves with same role got overwritten —
// some intermediate saves user named earlier no longer exist.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav'));
const WANT = [
  ['T5_defeat',    'Turn 5 auto resolved battle'],
  ['T7_end',       'Turn 7 End'],
  ['T7_governor',  'Turn 7 New Governour'],
  ['T7_merge',     'Turn 7 merge units'],
  ['T8_start',     'Turn 8 Start'],
  ['T8_defeat',    'Turn 8 average defeat'],
];

function readCounters(buf) {
  return {
    year:   buf.readInt32LE(0x504),
    evtCtr: buf.readUInt32LE(0xefd),
  };
}

const bufs = {};
console.log('tag'.padEnd(14) + '  size       year   evtCtr');
for (const [tag, pat] of WANT) {
  const found = allFiles.find(f => f.includes(pat));
  if (!found) { console.log('  MISSING', pat); continue; }
  const buf = fs.readFileSync(path.join(BASE, found));
  bufs[tag] = buf;
  const c = readCounters(buf);
  console.log(tag.padEnd(14) + '  ' + buf.length.toString().padStart(8) +
              '  ' + c.year.toString().padStart(5) +
              '  ' + c.evtCtr.toString().padStart(8));
}

console.log('\n=== Pairwise deltas ===');
const pairs = [
  ['T5_defeat',   'T7_end'],     // multi-turn jump
  ['T7_end',      'T7_governor'],
  ['T7_governor', 'T7_merge'],
  ['T7_merge',    'T8_start'],   // End Turn 7
  ['T8_start',    'T8_defeat'],
];
for (const [a, b] of pairs) {
  if (!bufs[a] || !bufs[b]) continue;
  const ca = readCounters(bufs[a]), cb = readCounters(bufs[b]);
  console.log('  ' + a.padEnd(14) + ' → ' + b.padEnd(14) +
              '  Δsize=' + (bufs[b].length - bufs[a].length).toString().padStart(7) +
              '  Δyear=' + (cb.year - ca.year).toString().padStart(2) +
              '  Δevt=' + (cb.evtCtr - ca.evtCtr).toString().padStart(5));
}

// New-governor decode: T7_end → T7_governor is suspect — but more reliable
// is testing if "Governor" or character names appear differently
console.log('\n=== Search for "Governor" + nearby character UTF-16 in T7_governor vs T7_end ===');
function findUtf16(buf, str) {
  const needle = Buffer.from([...str].flatMap(c => [c.charCodeAt(0), 0]));
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}
for (const w of ['Sparta', 'Governor', 'Pella']) {
  const a = bufs.T7_end ? findUtf16(bufs.T7_end, w) : [];
  const b = bufs.T7_governor ? findUtf16(bufs.T7_governor, w) : [];
  console.log('  "' + w + '": T7_end=' + a.length + ' T7_governor=' + b.length);
}

// Find atomic diff for T7_governor (T7_end → T7_governor)
if (bufs.T7_end && bufs.T7_governor) {
  const a = bufs.T7_end, b = bufs.T7_governor;
  console.log('\nT7_end size:', a.length, ' T7_governor size:', b.length, ' Δ=' + (b.length - a.length));
  console.log('Note: appointing governor SHRANK the file by ' + (a.length - b.length) + ' bytes (negative-delta action).');
  // Quick mismatch count
  let mismatches = 0;
  const positions = [];
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      mismatches++;
      if (positions.length < 20) positions.push(i);
    }
  }
  console.log('First-' + len + '-bytes mismatches:', mismatches);
  console.log('First 20 mismatch offsets:', positions.map(o => '0x' + o.toString(16)).join(', '));
}

// T8 defeat: another defeat datapoint
if (bufs.T8_start && bufs.T8_defeat) {
  console.log('\n=== T8_start → T8_defeat (another battle defeat) ===');
  console.log('Sizes:', bufs.T8_start.length, '→', bufs.T8_defeat.length, 'Δ=' + (bufs.T8_defeat.length - bufs.T8_start.length));
  console.log('Counter:', bufs.T8_start.readUInt32LE(0xefd), '→', bufs.T8_defeat.readUInt32LE(0xefd));
}
