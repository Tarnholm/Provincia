// Session 26 — Cross-tab 697 mid-file non-canonical cells against scripted-event tile coords (X,Y)
// Hypothesis: the 5632 scripted-event records have (X,Y) tile coords; do those overlap with
// the 697 non-canonical cells?

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Mid-file tile grid: ARR_START=0xf8fd2, STRIDE=267, 240×238 cells
// Canonical value pattern: [u32 100][u32 1][u32 200][u32 200][u32 2][u32 6][u32 200] (per session 12)
// We need to first re-derive the 697 non-canonical cells.

const ARR_START = 0xf8fd2;
const ROWS = 238;
const COLS = 240;
const STRIDE = 267;
const N = ROWS * COLS;

console.log('Mid-file array: ARR_START=0x' + ARR_START.toString(16), 'STRIDE=' + STRIDE, 'CELLS=' + N);

// Identify non-canonical cells. Canonical = f16==200 && f20==200 && f24==2 && f28==6 && f32==200
// f16 = offset within record where the canonical 200 lives
// Per session 14: variant key was "f16_f20_f24_f28_f32"
// 200_200_2_6_200 = canonical
// Need to identify exact byte positions

// Per session 22 (need to check): each cell has 5 key u32s at +16, +20, +24, +28, +32
const nonCanon = [];
const CANON = [200, 200, 2, 6, 200];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const o = ARR_START + (r*COLS + c)*STRIDE;
    if (o + 36 > buf.length) continue;
    const f16 = buf.readUInt32LE(o+16);
    const f20 = buf.readUInt32LE(o+20);
    const f24 = buf.readUInt32LE(o+24);
    const f28 = buf.readUInt32LE(o+28);
    const f32 = buf.readUInt32LE(o+32);
    if (f16!==CANON[0]||f20!==CANON[1]||f24!==CANON[2]||f28!==CANON[3]||f32!==CANON[4]) {
      nonCanon.push({r, c, o, f16, f20, f24, f28, f32});
    }
  }
}
console.log('Non-canonical cells found:', nonCanon.length);

// Interior non-canonical cells: exclude edges
// Per session 25, the "697 interior" count was after edge-exclusion
// Edges: r in {0, 237}, c in {0, 239}
const interior = nonCanon.filter(cell => cell.r > 0 && cell.r < 237 && cell.c > 0 && cell.c < 239);
console.log('Interior non-canonical cells:', interior.length);

// Read 5632 scripted-event records
const REC_START = 0x84f1c + 3;  // start at first record body
const REC_END = 0xa8b3d;
const SE_STRIDE = 26;

const matches = [];
for (let o = 0x84f1c; o < REC_END - 6; o++) {
  if (buf[o]===0xff && buf[o+1]===0xff && buf[o+2]===0xff && buf[o+3]===0xff
      && (buf[o+4]===0x00 || buf[o+4]===0x01) && buf[o+5]===0x01) {
    matches.push(o);
  }
}
const seRecs = [];
for (let i = 0; i < matches.length; i++) {
  const start = i===0 ? 0x84f1c+3 : matches[i-1]+6;
  const end = matches[i];
  if (end - start !== 20) continue;
  const X = buf.readUInt32LE(start+8);
  const Y = buf.readUInt32LE(start+12);
  seRecs.push({X, Y});
}
console.log('Scripted-event records:', seRecs.length);

// Now: map scripted-event (X, Y) to grid cell (c, r)
// Map is 1020x700 pixels (per session 25); grid is 240x238 cells; so PX_PER_CELL_X=4.25, PX_PER_CELL_Y=2.94
// X=311 (etna) → c=311/4.25 ≈ 73
// Y=344 (etna) → r=344/2.94 ≈ 117
// But the TGA Y-flip per session 25: tga_y = 699 - descr_y
// Wait - scripted-event Y is what coordinate space? Same as descr_strat? Or TGA?
// Going to test both

function evToCell(X, Y, flipY=false) {
  const yEff = flipY ? (699 - Y) : Y;
  const c = Math.floor(X / 4.25);
  const r = Math.floor(yEff / 2.941);
  return {c, r};
}

// Quick sanity check
console.log('\nSanity: Etna (311, 344): cell=' + JSON.stringify(evToCell(311, 344)) + ' flipY=' + JSON.stringify(evToCell(311, 344, true)));
console.log('Sanity: Rhodes (465, 336): cell=' + JSON.stringify(evToCell(465, 336)) + ' flipY=' + JSON.stringify(evToCell(465, 336, true)));

// Build a set of interior non-canonical cell coords
const nonCanonSet = new Set();
for (const cell of interior) nonCanonSet.add(cell.c + ',' + cell.r);

// Test 1: non-flipped Y
let hitsRaw = 0, hitsFlip = 0;
for (const ev of seRecs) {
  const cellRaw = evToCell(ev.X, ev.Y);
  if (nonCanonSet.has(cellRaw.c + ',' + cellRaw.r)) hitsRaw++;
  const cellFlip = evToCell(ev.X, ev.Y, true);
  if (nonCanonSet.has(cellFlip.c + ',' + cellFlip.r)) hitsFlip++;
}
console.log('\nScripted-event coords → non-canonical interior cell hits:');
console.log('  Raw Y mapping: ' + hitsRaw + ' / ' + seRecs.length + ' (' + (100*hitsRaw/seRecs.length).toFixed(1) + '%)');
console.log('  Y-flipped:     ' + hitsFlip + ' / ' + seRecs.length + ' (' + (100*hitsFlip/seRecs.length).toFixed(1) + '%)');

// Baseline: random cells from canonical population
function randomCanonHits(N_samples, flipY=false) {
  const canonical = [];
  for (let r = 1; r < 237; r++) {
    for (let c = 1; c < 239; c++) {
      const o = ARR_START + (r*COLS + c)*STRIDE;
      if (o + 36 > buf.length) continue;
      const f16 = buf.readUInt32LE(o+16);
      const f20 = buf.readUInt32LE(o+20);
      const f24 = buf.readUInt32LE(o+24);
      const f28 = buf.readUInt32LE(o+28);
      const f32 = buf.readUInt32LE(o+32);
      if (f16===200&&f20===200&&f24===2&&f28===6&&f32===200) canonical.push({c, r});
    }
  }
  // Sample 5632 random canonical cells, check how many would have matched
  // The fairer baseline: probability a random map (X,Y) lands in a non-canonical cell
  // = nonCanonInterior / (interior total) = 697 / (236*238) = 697 / 56168 = 1.24%
  const baselineRate = interior.length / (236*238);
  return baselineRate * N_samples;
}
const baseline = randomCanonHits(seRecs.length);
console.log('  Baseline expected: ' + baseline.toFixed(1));
console.log('  Enrichment (raw):    ' + (hitsRaw / baseline).toFixed(2) + 'x');
console.log('  Enrichment (flip-Y): ' + (hitsFlip / baseline).toFixed(2) + 'x');

// Per-event-coord type breakdown
const namedEvents = [
  {name:'eruption_at_etna', X:311, Y:344},
  {name:'eruption_at_vulcano', X:311, Y:353},
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
console.log('\n=== Per named-event location: in non-canonical zone? ===');
for (const ev of namedEvents) {
  const cellRaw = evToCell(ev.X, ev.Y);
  const cellFlip = evToCell(ev.X, ev.Y, true);
  const rawHit = nonCanonSet.has(cellRaw.c + ',' + cellRaw.r);
  const flipHit = nonCanonSet.has(cellFlip.c + ',' + cellFlip.r);
  console.log('  ' + ev.name.padEnd(28) + ' (' + ev.X + ',' + ev.Y + '): rawCell=(' + cellRaw.c + ',' + cellRaw.r + ')' + (rawHit ? ' NONCANON' : '') + ' flipCell=(' + cellFlip.c + ',' + cellFlip.r + ')' + (flipHit ? ' NONCANON' : ''));
}

// Also test wider radius — within 1 or 2 cells of a non-canonical cell
function nearestNonCanon(c, r) {
  let best = Infinity;
  for (const cell of interior) {
    const d = Math.max(Math.abs(cell.c - c), Math.abs(cell.r - r));
    if (d < best) best = d;
  }
  return best;
}
console.log('\n=== Distance of scripted-event coords to nearest non-canonical cell ===');
const distH = {0:0,1:0,2:0,3:0,4:0,5:0,'5+':0};
for (const ev of seRecs) {
  const cell = evToCell(ev.X, ev.Y);
  const d = nearestNonCanon(cell.c, cell.r);
  if (d <= 5) distH[d]++;
  else distH['5+']++;
}
Object.entries(distH).forEach(([k,v])=>console.log('  dist=' + k + ': ' + v));

// Random baseline distance
const randDistH = {0:0,1:0,2:0,3:0,4:0,5:0,'5+':0};
for (let i = 0; i < seRecs.length; i++) {
  const c = 1 + Math.floor(Math.random()*238);
  const r = 1 + Math.floor(Math.random()*236);
  const d = nearestNonCanon(c, r);
  if (d <= 5) randDistH[d]++;
  else randDistH['5+']++;
}
console.log('  Random baseline:');
Object.entries(randDistH).forEach(([k,v])=>console.log('    rand-dist=' + k + ': ' + v));
