// Session 26 — Parse all 5632 records of the scripted-event firing log
// 26-byte stride, starting at 0x84f1c, format:
//   [u16 sub][u32 type][u32 tileX][u32 tileY][u32 hash][u8 ff×4][u8 b1][u8 b2]
//
// Verify by examining the data distribution.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Records start at 0x84f1c; each is 26 bytes
const REC_START = 0x84f1c;
const REC_END = 0xa8b3d;  // wonders start here
const STRIDE = 26;
const N = Math.floor((REC_END - REC_START) / STRIDE);
console.log('Records:', N, 'at stride 26');

const recs = [];
for (let i = 0; i < N; i++) {
  const o = REC_START + i*STRIDE;
  const sub = buf.readUInt16LE(o);
  const type = buf.readUInt32LE(o+2);
  const X = buf.readUInt32LE(o+6);
  const Y = buf.readUInt32LE(o+10);
  const hash = buf.readUInt32LE(o+14);
  const t1 = buf.readUInt32LE(o+18);   // should be 0xffffffff
  const b1 = buf[o+22];
  const b2 = buf[o+23];
  const b3 = buf[o+24];
  const b4 = buf[o+25];
  recs.push({i, o, sub, type, X, Y, hash, t1, b1, b2, b3, b4});
}

// Validate: t1 should be 0xffffffff in nearly all records
const t1H = {};
for (const r of recs) t1H[r.t1>>>0] = (t1H[r.t1>>>0]||0)+1;
console.log('t1 (post-fields u32) distribution:');
Object.entries(t1H).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([t,c])=>console.log('  0x' + (parseInt(t)>>>0).toString(16).padStart(8,'0') + ': ' + c));

// Distribution of trailing byte pair (b1, b2)
const bH = {};
for (const r of recs) {
  const k = r.b1 + ',' + r.b2;
  bH[k] = (bH[k]||0)+1;
}
console.log('\n(b1,b2) trail byte pair distribution top 10:');
Object.entries(bH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,c])=>console.log('  (' + k + '): ' + c));

// Distribution of type (event-kind)
const typeH = {};
for (const r of recs) typeH[r.type] = (typeH[r.type]||0)+1;
console.log('\nType (event-kind) distribution:');
Object.entries(typeH).sort((a,b)=>b[1]-a[1]).forEach(([t,c])=>console.log('  type=' + t + ': ' + c));

// Distribution of "sub" — looks like a small int
const subH = {};
for (const r of recs) subH[r.sub] = (subH[r.sub]||0)+1;
const subS = Object.entries(subH).sort((a,b)=>b[1]-a[1]);
console.log('\nSub distribution (top 15):');
subS.slice(0,15).forEach(([s,c])=>console.log('  sub=' + s.padStart(4) + ' (0x' + parseInt(s).toString(16).padStart(2,'0') + '): ' + c));
console.log('Distinct sub values:', subS.length);

// X, Y range (tile coords)
const Xs = recs.map(r=>r.X), Ys = recs.map(r=>r.Y);
console.log('\nX range:', Math.min(...Xs), '..', Math.max(...Xs));
console.log('Y range:', Math.min(...Ys), '..', Math.max(...Ys));

// X and Y span the campaign map; 0..1024 X, 0..768 Y? Confirm
// Campaign map TGA is 1020x700 per session 25. Yes — these are pixel/tile coords.

// Distinct (X,Y) points — these are scripted-event-locations
const xySet = new Set();
for (const r of recs) xySet.add(r.X + ',' + r.Y);
console.log('\nDistinct (X,Y) points:', xySet.size);

// Distribution of "hash" — top values
const hH = {};
for (const r of recs) hH[r.hash>>>0] = (hH[r.hash>>>0]||0)+1;
console.log('\nHash distribution (top 20):');
Object.entries(hH).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([h,c])=>console.log('  0x' + (parseInt(h)>>>0).toString(16).padStart(8,'0') + ': ' + c));
console.log('Distinct hashes:', Object.keys(hH).length);

// Cross-correlate with named-event (X,Y) coordinates from dig-scripted-events2
const namedEventCoords = [
  {name:'eruption_at_etna', X:311, Y:344},
  {name:'eruption_at_vulcano', X:311, Y:353},
  {name:'eruption_at_ischia', X:299, Y:387},
  {name:'eruption_at_santorini', X:432, Y:331},
  {name:'earthquake_at_santorini', X:435, Y:334},
  {name:'eruption_at_methana', X:203, Y:173},
  {name:'earthquake_in_rhodes', X:465, Y:336},
  {name:'earthquake_in_iberia', X:53, Y:459},
  {name:'flood_in_rome_241', X:294, Y:403},
  // Wonders
  {name:'pyramids_and_sphinx', X:514, Y:249},
  {name:'pharos', X:497, Y:266},
  {name:'colossus', X:465, Y:337},
  {name:'temple', X:452, Y:356},
  {name:'statue', X:388, Y:345},
  {name:'gardens', X:668, Y:326},
  {name:'mausoleum', X:456, Y:343},
];
console.log('\n=== Records matching named-event coordinates (radius 2 tiles) ===');
for (const ev of namedEventCoords) {
  const matches = recs.filter(r=>Math.abs(r.X-ev.X) <= 2 && Math.abs(r.Y-ev.Y) <= 2);
  console.log('  ' + ev.name.padEnd(28) + ' @ (' + ev.X + ',' + ev.Y + '): ' + matches.length + ' nearby records');
}

// First 30 records dump
console.log('\n=== First 30 records ===');
recs.slice(0, 30).forEach(r=>console.log('  [' + r.i.toString().padStart(5) + '] 0x' + r.o.toString(16) + ' sub=' + r.sub.toString().padStart(3) + ' type=' + r.type + ' X=' + r.X.toString().padStart(4) + ' Y=' + r.Y.toString().padStart(4) + ' hash=0x' + (r.hash>>>0).toString(16).padStart(8,'0') + ' b1=' + r.b1 + ' b2=' + r.b2 + ' b3=' + r.b3 + ' b4=' + r.b4));

// Coverage of unique (X,Y) on campaign map regions
// Cross-reference public/regions_large.json
const PROVDIR = 'C:/dev/Provincia/public/';
let regions = null;
try {
  regions = JSON.parse(fs.readFileSync(PROVDIR + 'regions_large.json', 'utf8'));
  console.log('\n=== Region cross-reference ===');
  // regions is array of {Name, CenterPixelXY: [x, y], ...}
  if (regions.regions) regions = regions.regions;
  console.log('Loaded', regions.length, 'regions');
  // For first 5 events, find nearest region
  for (let i = 0; i < 8; i++) {
    const r = recs[i];
    let best = null, bestD = Infinity;
    for (const reg of regions) {
      const c = reg.CenterPixelXY || reg.center || reg.center_pixel || null;
      if (!c) continue;
      const cx = Array.isArray(c) ? c[0] : c.x;
      const cy = Array.isArray(c) ? c[1] : c.y;
      const d = Math.hypot(r.X - cx, r.Y - cy);
      if (d < bestD) { bestD = d; best = reg; }
    }
    if (best) console.log('  rec[' + i + '] (' + r.X + ',' + r.Y + ') nearest region: ' + (best.Name||best.name||'?') + ' (d=' + bestD.toFixed(1) + ')');
  }
} catch(e) {
  console.log('No regions_large.json:', e.message);
}

// Plausible interpretation:
// Each 26-byte record = one fired-event entry
// sub: event-detail counter (0..63?)
// type: 1=eruption, 2=earthquake, 3=flood, 4=wonder, etc.
// X, Y: tile coords (= scripted-event location)
// hash: per-event UUID
// b1, b2: 6-byte delimiter "ff ff ff ff 01 01" but b1/b2 differ — these might encode "fired/pending"
//
// 5632 records / fired-events: this looks like a HUGE log. Maybe it's per-tile/per-year cross-product?
// Let me check: 25 volcano scripts × ~226 years of campaign ≈ 5650. Match!
// Or — 25 volcanoes × (years between minor eruptions) — these are SCHEDULED firings
console.log('\n=== Records-per-coord cross-reference ===');
// For top 8 distinct (X,Y), count records
const xyCounts = {};
for (const r of recs) {
  const k = r.X + ',' + r.Y;
  xyCounts[k] = (xyCounts[k]||0)+1;
}
const topXY = Object.entries(xyCounts).sort((a,b)=>b[1]-a[1]).slice(0,20);
console.log('Top 20 coords by record count:');
topXY.forEach(([k,c])=>console.log('  (' + k + '): ' + c));
