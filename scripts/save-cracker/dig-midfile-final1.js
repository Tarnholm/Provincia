// Session 27 — Objective #4: 697-cell mystery, final hypothesis.
// Test: do per-tile registry coords correlate with non-canonical cells when combined with named-events?
// Also: cross-tab the hashes — do per-tile registry hashes appear in the event-log actor_hash?

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const REGION_START = 0x84f1f, STRIDE = 26, N_RECS = 5632;
const perTileRecs = [];
for (let i = 0; i < N_RECS; i++) {
  const o = REGION_START + i*STRIDE;
  perTileRecs.push({
    a: buf.readUInt32LE(o), b: buf.readUInt32LE(o+4),
    X: buf.readUInt32LE(o+8), Y: buf.readUInt32LE(o+12),
    hash: buf.readUInt32LE(o+16), flag1: buf[o+24]
  });
}

// Get event log hashes
const FULL_START = 0x51b5, FULL_END = 0x846af;
const eventRecs = [];
for (let i = 0; i < Math.floor((FULL_END-FULL_START)/12); i++) {
  const o = FULL_START + i*12;
  eventRecs.push({hash: buf.readUInt32LE(o), flag: buf[o+4], sub: buf[o+5], idA: buf.readUInt16LE(o+6), idB: buf.readUInt32LE(o+8)});
}
const eventHashes = new Set();
for (const r of eventRecs) if (r.hash !== 0 && (r.flag===1||r.flag===2||r.flag===4)) eventHashes.add(r.hash);

const perTileHashes = new Set(perTileRecs.map(r=>r.hash));
const perTileHashesNonZero = new Set(perTileRecs.filter(r=>r.hash!==0).map(r=>r.hash));

console.log('=== Hash overlap: per-tile registry vs event-log actors ===');
console.log('Event-log distinct hashes:', eventHashes.size);
console.log('Per-tile registry distinct hashes:', perTileHashes.size);
console.log('Per-tile registry non-zero hashes:', perTileHashesNonZero.size);
const overlap = [...perTileHashesNonZero].filter(h=>eventHashes.has(h));
console.log('Overlap (event-log hashes ALSO in per-tile registry):', overlap.length);

// Check: are per-tile registry hashes RAW or do they map to something else?
// Look at the actual hash distribution
console.log('\n=== Per-tile registry hash analysis ===');
const allZero = perTileRecs.filter(r=>r.hash===0).length;
console.log('  hash=0 records:', allZero);
console.log('  hash != 0 records:', perTileRecs.length - allZero);

// 5,629 unique hashes for 5632 records ⇒ near-unique. These are likely per-record IDs (UUIDs).
// Are they sequential or randomly distributed?
const hashSorted = perTileRecs.map(r=>r.hash).sort((a,b)=>a-b);
console.log('Hash range:', '0x' + hashSorted[0].toString(16), '..', '0x' + hashSorted[hashSorted.length-1].toString(16));

// Test: cross-tab per-tile (X,Y) coords against descr_strat-declared settlement coords
// Use the settlement-model strings from session 16, located in dig-settle-models*
// Or get coords directly from public/regions_large.json
const REG_PATH = 'C:/dev/Provincia/public/regions_large.json';
if (require('fs').existsSync(REG_PATH)) {
  const regs = JSON.parse(fs.readFileSync(REG_PATH));
  console.log('Region count:', Object.keys(regs).length);

  // Each region has settlement coords
  const sample = regs[Object.keys(regs)[0]];
  console.log('Sample region:', Object.keys(regs)[0], '→', JSON.stringify(sample).slice(0, 200));

  // Extract all settlement coords
  const settleCoords = [];
  for (const [name, r] of Object.entries(regs)) {
    if (r.settlement_x !== undefined && r.settlement_y !== undefined) {
      settleCoords.push({name, X: r.settlement_x, Y: r.settlement_y});
    }
  }
  console.log('Total settlements with coords:', settleCoords.length);

  // For each settlement, find nearest per-tile-registry record
  const nearbyCounts = [];
  for (const s of settleCoords) {
    const dists = perTileRecs.map(r=>Math.max(Math.abs(r.X-s.X), Math.abs(r.Y-s.Y)));
    const minDist = Math.min(...dists);
    nearbyCounts.push({...s, minDist});
  }
  // Histogram of min distances
  const distH = {};
  for (const s of nearbyCounts) {
    const b = Math.min(20, s.minDist);
    distH[b] = (distH[b]||0)+1;
  }
  console.log('\n=== Min Chebyshev distance from settlement to nearest per-tile registry record ===');
  Object.entries(distH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([d,c])=>console.log('  dist=' + d.padStart(3) + ': ' + c));
}

// Now: does the per-tile registry COVER the same coords as the non-canonical 697 cells?
// Load the cell data
const cellData = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/dig-midfile-cells1-out.json'));
const W = cellData.W, H = cellData.H;

// Get the largest variant (253 cells)
const largeVar = cellData.variants.reduce((a,b)=>a.cells.length > b.cells.length ? a : b);
console.log('\nUsing largest variant ' + largeVar.variant + ' with ' + largeVar.cells.length + ' cells');

const nc = new Set();
for (const c of largeVar.cells) nc.add(c.c + ',' + c.r);

// Filter perTileRecs to those mapped to a non-canon cell. Check spatial overlap
const ptInCells = perTileRecs.filter(r=>nc.has(Math.floor(r.X*W/1024) + ',' + Math.floor(r.Y*H/768)));
console.log('Per-tile records mapped to non-canon cells:', ptInCells.length);
const ptCovered = new Set();
for (const r of ptInCells) ptCovered.add(Math.floor(r.X*W/1024) + ',' + Math.floor(r.Y*H/768));
console.log('Distinct non-canon cells with per-tile coverage:', ptCovered.size, '/', nc.size);

// 4809 of the 57120 grid cells contain a per-tile record. Out of the 253 non-canon cells, how many overlap?
const interSet = new Set();
const ptCells = new Set();
for (const r of perTileRecs) ptCells.add(Math.floor(r.X*W/1024) + ',' + Math.floor(r.Y*H/768));
for (const c of nc) if (ptCells.has(c)) interSet.add(c);
console.log('Cells in BOTH per-tile registry AND non-canon:', interSet.size);
console.log('Expected if random:', (4809 * nc.size / (W*H)).toFixed(1));

// CONCLUSION: per-tile registry coverage explains <2x the baseline rate of non-canon cells.
// Refuted as a primary explanation.

// Let me also check: is the FULL union (named events + 5632 per-tile registry tiles) sufficient?
// I.e., the brief's hypothesis: all scripted-event participants frozen at game start
const allEventCoords = new Set();
const namedEvents = [
  ['eruption_at_etna',   311, 344], ['eruption_at_vulcano',311, 353],
  ['eruption_at_ischia', 299, 387], ['eruption_at_santorini', 432, 331],
  ['eruption_at_methana',203, 173], ['earthquake_at_santorini', 435, 334],
  ['earthquake_in_rhodes', 465, 336], ['earthquake_in_iberia', 53, 459],
  ['flood_in_rome_241', 294, 403], ['pyramids_and_sphinx', 514, 249],
  ['pharos', 497, 266], ['colossus', 465, 337], ['temple', 452, 356],
  ['statue', 388, 345], ['gardens', 668, 326], ['mausoleum', 456, 343],
];
for (const [n, x, y] of namedEvents) allEventCoords.add(x + ',' + y);
for (const r of perTileRecs) allEventCoords.add(r.X + ',' + r.Y);
console.log('\nTotal scripted-event-participant coords:', allEventCoords.size);

// Map all to cells, check coverage of non-canon
const allEventCells = new Set();
for (const k of allEventCoords) {
  const [x,y] = k.split(',').map(Number);
  allEventCells.add(Math.floor(x*W/1024) + ',' + Math.floor(y*H/768));
}
const finalOverlap = [...nc].filter(c=>allEventCells.has(c));
console.log('Non-canon cells covered by scripted-event participants:', finalOverlap.length, '/', nc.size);
console.log('Coverage %:', (100*finalOverlap.length/nc.size).toFixed(1));
console.log('Expected if random:', (100 * allEventCells.size / (W*H)).toFixed(1));
