// Session 26 — Correct alignment for scripted-event firing log
// 26-byte records. Record starts AFTER the delimiter. Each record:
//   [u16 sub_idx][u32 type_id][u32 tileX][u32 tileY][u32 hash][u32 ff_marker][u16 trail]
// Total = 2+4+4+4+4+4+2 = 24 bytes ... but stride is 26. Let me recheck.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// FIND the delimiters and use them to identify record boundaries
const REGION_START = 0x84f1c;
const REGION_END = 0xa8b3d;

const matches = [];
for (let o = REGION_START; o < REGION_END - 6; o++) {
  if (buf[o]===0xff && buf[o+1]===0xff && buf[o+2]===0xff && buf[o+3]===0xff
      && (buf[o+4]===0x00 || buf[o+4]===0x01) && buf[o+5]===0x01) {
    matches.push(o);
  }
}
console.log('Delimiters found:', matches.length);

// Each record is BEFORE its delimiter. The PRECEDING record ends at matches[i]+6 (after delim)
// Let's reconstruct record bodies: record[0] starts at REGION_START, ends at matches[0]+6
// Record body is from prev-end to next-start; payload size = 20 bytes
console.log('First 5 record bodies (between delimiters):');
for (let i = 0; i < 5; i++) {
  const start = i===0 ? REGION_START : matches[i-1]+6;
  const end = matches[i];
  console.log('  rec[' + i + '] bytes 0x' + start.toString(16) + '..0x' + end.toString(16) + ' (' + (end-start) + ' B):');
  const slice = buf.subarray(start, end);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('    hex:', hex);
}

// So record bodies are 20 bytes
// 20 bytes / 4 = 5 u32 fields
// Format: [u32 a][u32 b][u32 c][u32 d][u32 hash]
// then 6-byte delimiter "ff ff ff ff 0X 01"
// Total stride = 26 bytes

console.log('\n=== Parsing 5632 records: 5 u32 fields per record ===');
const recs = [];
for (let i = 0; i < matches.length; i++) {
  const start = i===0 ? REGION_START : matches[i-1]+6;
  const end = matches[i];
  if (end - start !== 20) continue;  // skip if not 20B
  const a = buf.readUInt32LE(start);
  const b = buf.readUInt32LE(start+4);
  const c = buf.readUInt32LE(start+8);
  const d = buf.readUInt32LE(start+12);
  const e = buf.readUInt32LE(start+16);
  const delim4 = buf[matches[i]+4];
  recs.push({i, off:start, a, b, c, d, e, delim4});
}
console.log('Parsed records:', recs.length);

// Distributions
function dist(field, label) {
  const h = {};
  for (const r of recs) h[r[field]] = (h[r[field]]||0)+1;
  const top = Object.entries(h).sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log('\n' + label + ' (top 10 of ' + Object.keys(h).length + '):');
  top.forEach(([v,c])=>console.log('  ' + v + ': ' + c));
}
dist('a', 'a (u32 @ +0)');
dist('b', 'b (u32 @ +4)');
dist('c', 'c (u32 @ +8)');
dist('d', 'd (u32 @ +12)');
dist('e', 'e (u32 @ +16) hash');
dist('delim4', 'delim byte @ +4 (0 or 1)');

// a's range
const aR = recs.map(r=>r.a);
const bR = recs.map(r=>r.b);
const cR = recs.map(r=>r.c);
const dR = recs.map(r=>r.d);
console.log('\nRanges:');
console.log('  a:', Math.min(...aR), '..', Math.max(...aR));
console.log('  b:', Math.min(...bR), '..', Math.max(...bR));
console.log('  c:', Math.min(...cR), '..', Math.max(...cR));
console.log('  d:', Math.min(...dR), '..', Math.max(...dR));

// Cross-correlate with named-event coords
const namedEventCoords = [
  {name:'eruption_at_etna', X:311, Y:344},
  {name:'eruption_at_vulcano', X:311, Y:353},
  {name:'eruption_at_ischia', X:299, Y:387},
  {name:'eruption_at_santorini', X:432, Y:331},
  {name:'eruption_at_methana', X:203, Y:173},
  {name:'earthquake_in_rhodes', X:465, Y:336},
  {name:'earthquake_in_iberia', X:53, Y:459},
  {name:'flood_in_rome_241', X:294, Y:403},
  {name:'pyramids_and_sphinx', X:514, Y:249},
  {name:'pharos', X:497, Y:266},
  {name:'colossus', X:465, Y:337},
  {name:'temple', X:452, Y:356},
  {name:'statue', X:388, Y:345},
  {name:'gardens', X:668, Y:326},
  {name:'mausoleum', X:456, Y:343},
];

// Test all 4 possible (X,Y) field pairings
console.log('\n=== Field-pair-as-XY cross-check vs known event coords ===');
const pairings = [['a','b'],['b','c'],['c','d'],['a','c'],['b','d']];
for (const [fx, fy] of pairings) {
  let totalMatches = 0;
  for (const ev of namedEventCoords) {
    const nearby = recs.filter(r=>Math.abs(r[fx]-ev.X) <= 3 && Math.abs(r[fy]-ev.Y) <= 3).length;
    if (nearby > 0) totalMatches += nearby;
  }
  console.log('  (' + fx + ',' + fy + ') as (X,Y): total cross-matches = ' + totalMatches);
}

// Also try interpreting fields as i16/i32 with different unpackings
// Maybe (c, d) are X, Y as signed
console.log('\n=== Display first 10 records with all 5 fields decoded ===');
recs.slice(0, 10).forEach(r=>{
  console.log('  [' + r.i + '] off=0x' + r.off.toString(16) +
    ' a=' + r.a.toString().padStart(5) +
    ' b=' + r.b.toString().padStart(5) +
    ' c=' + r.c.toString().padStart(5) +
    ' d=' + r.d.toString().padStart(5) +
    ' hash=0x' + (r.e>>>0).toString(16).padStart(8,'0') +
    ' delim4=' + r.delim4);
});

// Inspect record sizes more carefully - non-20 byte records
const sizeH = {};
for (let i = 0; i < matches.length; i++) {
  const start = i===0 ? REGION_START : matches[i-1]+6;
  const sz = matches[i] - start;
  sizeH[sz] = (sizeH[sz]||0)+1;
}
console.log('\nRecord-size distribution:');
Object.entries(sizeH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([s,c])=>console.log('  ' + s + 'B: ' + c));
