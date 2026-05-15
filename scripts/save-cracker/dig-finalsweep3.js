// Session 65 sweep 3 — characterize the stride-9 record family inside top-10 unknowns.
// Goal: validate that records have the exact form  XX YY ZZ NN 00 00 00 00 00
// where NN is in a tight enum of {0x00,0x10,0x20,0x30,0x40,0x50,0x60,0x70,0x80} and
// XX YY ZZ is a 24-bit identifier.

const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const ranges = [
  [0x00f84632, 0x00f85f5c, 6442],
  [0x01f17f18, 0x01f18948, 2608],
  [0x01f170f5, 0x01f17b0f, 2586],
  [0x015fb87c, 0x015fc177, 2299],
  [0x015cfe7b, 0x015d0772, 2295],
  [0x015d088a, 0x015d1181, 2295],
  [0x015d1299, 0x015d1b90, 2295],
  [0x015d1ca8, 0x015d259f, 2295],
  [0x016091aa, 0x01609a9a, 2288],
  [0x015e72b9, 0x015e7ba2, 2281],
];

// For each, find the offset that aligns to stride-9, and report:
//  - records that match (5 trailing zeros, type-nibble enum)
//  - distinct type-byte values
//  - distinct upper bytes of u24 (XX,YY,ZZ pattern)
//  - prefix/suffix bytes that don't fit the stride

function ascii(b, len) {
  let s = '';
  for (let i = 0; i < len && i < b.length; i++) {
    const c = b[i];
    s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
  }
  return s;
}
function hex(b, len) {
  let s = '';
  for (let i = 0; i < len && i < b.length; i++) s += b[i].toString(16).padStart(2, '0') + ' ';
  return s;
}

function analyze(s, e) {
  console.log(`\n--- range 0x${s.toString(16)}..0x${e.toString(16)} (${e-s} B) ---`);
  // Try each offset 0..8, count records that match XX YY ZZ NN 00 00 00 00 00 with NN in enum.
  let best = -1, bestCount = -1;
  for (let off = 0; off < 9; off++) {
    let ok = 0;
    let total = 0;
    for (let p = s + off; p + 9 <= e; p += 9) {
      total++;
      const b3 = buf[p+3];
      if (buf[p+4]===0 && buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0 &&
          (b3 & 0x0f) === 0 && b3 <= 0x80) ok++;
    }
    if (ok > bestCount) { bestCount = ok; best = off; }
  }
  const off = best;
  let ok = 0, total = 0;
  const typeSet = new Set();
  let minId = 0xFFFFFFFF, maxId = 0;
  for (let p = s + off; p + 9 <= e; p += 9) {
    total++;
    const b3 = buf[p+3];
    const zerosOk = buf[p+4]===0 && buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0;
    const typeOk = (b3 & 0x0f) === 0 && b3 <= 0x80;
    if (zerosOk && typeOk) {
      ok++;
      typeSet.add(b3);
      const id = buf[p] | (buf[p+1]<<8) | (buf[p+2]<<16);
      if (id < minId) minId = id;
      if (id > maxId) maxId = id;
    }
  }
  console.log(`  best off=${off} stride-9 matches: ${ok}/${total} (${(100*ok/total).toFixed(1)}%)`);
  console.log(`  type byte values: ${[...typeSet].sort((a,b)=>a-b).map(x=>'0x'+x.toString(16)).join(' ')}`);
  console.log(`  u24 id range: 0x${minId.toString(16)}..0x${maxId.toString(16)}`);
  // Show prefix (bytes before stride start) and suffix (bytes after last full record)
  const prefixLen = off;
  const fullRecs = Math.floor((e - s - off) / 9);
  const suffixLen = (e - s - off) - fullRecs * 9;
  console.log(`  prefix=${prefixLen}B: ${hex(buf.slice(s, s+prefixLen), prefixLen)}`);
  console.log(`  ${fullRecs} records, suffix=${suffixLen}B: ${hex(buf.slice(s+off+fullRecs*9, e), suffixLen)}`);
  // Check what comes BEFORE the range and AFTER the range — gives semantic context.
  const before = buf.slice(Math.max(0, s - 32), s);
  const after = buf.slice(e, Math.min(buf.length, e + 32));
  console.log(`  context-before (32B): ${hex(before, before.length)}`);
  console.log(`           ascii      : ${ascii(before, before.length)}`);
  console.log(`  context-after  (32B): ${hex(after, after.length)}`);
  console.log(`           ascii      : ${ascii(after, after.length)}`);

  return { s, e, off, ok, total, types: [...typeSet], minId, maxId };
}

const results = [];
for (const [s, e] of ranges) results.push(analyze(s, e));

// Pattern summary
console.log('\n=== Pattern summary ===');
for (const r of results) {
  console.log(`  0x${r.s.toString(16)} off=${r.off} ${r.ok}/${r.total} types=[${r.types.map(x=>'0x'+x.toString(16)).join(',')}] u24=${r.minId.toString(16)}..${r.maxId.toString(16)}`);
}
