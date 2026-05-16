// dig-aidip-8.js — Session 103/H
// CONFIRMED in dig-aidip-7: flipY orientation gives clean land/sea split.
// value=1 is exclusively land (99.9%). value=0 is mixed-but-sea-skewed.
//
// Now decode what each value represents. Hypotheses:
//  - value=1 = "explored land tile" (faction has scouted/owned it)
//  - value=0 = "unexplored or fog-of-war"
//  - value=2,3,4 = movement/strategic-AI metadata (per-tile)
//
// Evidence: ror_t11s.sav shows v=1 grew from 309k (T0) to 344k (T11s).
//          athens_t22e.sav shows v=1 = 359k. As campaigns progress, more
//          tiles get value=1. That's classic "more explored over time".
//
// To validate "value=1 = ever-explored":
//  - tiles around the Romans Julii capital (Arretium) should be v=1 in
//    save_10_fresh
//  - tiles in the far corners of the map should be v=0 in save_10_fresh
//
// Approach: pick the topY of the player faction record's home region,
// look at neighborhoods. Without knowing exact starting position, we'll
// compute v=1 density by quadrant — should be higher near origin.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

const ZONE_START = 0x18;
const ZONE_END   = 0x0c264;

function decodeRle(zone) {
  const tiles = [];
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    for (let k = 0; k < c; k++) tiles.push(v);
  }
  return tiles;
}

const W = 1020;
const H = 700;

// Decode into a 2D grid, applying flipY: grid[y][x] where y=0 is the TOP
// of the campaign map. Player's tile array is read in flipY order:
// gridFinal[y][x] = tiles[(H-1-y)*W + x]
function decodeGrid(file) {
  const { body } = loadPlayer(file);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const grid = new Uint8Array(W * H);
  for (let i = 0; i < W * H && i < tiles.length; i++) grid[i] = tiles[i];
  // Apply flipY for visual top-down rendering
  // But for our quadrant analysis we use the raw tile index — flipY is just
  // about matching geography. For quadrant statistics we don't care about flip.
  return grid;
}

function quadrantStats(grid, label) {
  const halves = { NW: {}, NE: {}, SW: {}, SE: {} };
  for (const k in halves) halves[k] = new Array(8).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.min(7, grid[y * W + x]);
      // NOTE: tile data is flipY relative to TGA, so y=0 here is SOUTH of the map.
      // Quadrants relative to grid storage:
      const isWest = x < W / 2;
      const isSouth = y < H / 2; // y=0 is south
      const q = isSouth ? (isWest ? 'SW' : 'SE') : (isWest ? 'NW' : 'NE');
      halves[q][v]++;
    }
  }
  return halves;
}

const saves = ['save_10_fresh.sav', 'ror_t1e.sav', 'ror_t11s.sav', 'athens_t21.sav', 'athens_t22e.sav'];

for (const s of saves) {
  const grid = decodeGrid(s);
  const q = quadrantStats(grid, s);
  console.log(`\n=== ${s} ===`);
  console.log(`Quadrant (rel to data, y=0 stored is SOUTH after flipY)`);
  for (const k of ['NW', 'NE', 'SW', 'SE']) {
    console.log(`  ${k}  v0=${q[k][0].toString().padStart(6)}  v1=${q[k][1].toString().padStart(6)}  v2=${q[k][2].toString().padStart(5)}  v3=${q[k][3].toString().padStart(5)}  v4=${q[k][4].toString().padStart(4)}  v5=${q[k][5].toString().padStart(4)}  v6=${q[k][6].toString().padStart(4)}`);
  }
}

// ===== Compare the same tile's value across saves =====
// Find tiles that changed from v=0 to v=1 between ror_t1e and ror_t11s.
// If these are "newly explored" they should cluster around Roman expansion areas.
console.log(`\n=== Tiles that flipped 0 -> 1 from ror_t1e to ror_t11s ===`);
{
  const a = decodeGrid('ror_t1e.sav');
  const b = decodeGrid('ror_t11s.sav');
  let count = 0;
  // Bin by (X bucket, Y bucket) to see spatial clustering
  const NX = 10, NY = 7;
  const bins = Array.from({length: NY}, () => new Array(NX).fill(0));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ia = a[y * W + x], ib = b[y * W + x];
      if (ia === 0 && ib === 1) {
        count++;
        bins[Math.floor(y * NY / H)][Math.floor(x * NX / W)]++;
      }
    }
  }
  console.log(`Total 0->1 tiles: ${count}`);
  console.log(`Spatial bin (rows = data Y bottom-up; cols = X left-right):`);
  // Print top-down so rows reverse for display
  for (let yi = NY - 1; yi >= 0; yi--) {
    const row = bins[yi].map(n => n.toString().padStart(6)).join(' ');
    console.log(`  y_idx=${yi} ${row}`);
  }
}

// ===== Check stability of v=0 over time for any specific tile =====
// Pick a corner tile, see if it stayed v=0 forever (truly unexplored)
console.log(`\n=== Per-tile sample: corner tiles across saves ===`);
{
  const samples = [
    [0, 0], [10, 10], [W-1, H-1], [W/2|0, H/2|0],
    [100, 100], [500, 200], [800, 400], [950, 650]
  ];
  console.log(`coords    save_10  ror_t1e  ror_t5  ror_t11s  athens_t22e`);
  for (const [x, y] of samples) {
    const g0 = decodeGrid('save_10_fresh.sav');
    const g1 = decodeGrid('ror_t1e.sav');
    const g5 = decodeGrid('ror_t5.sav');
    const g11 = decodeGrid('ror_t11s.sav');
    const g22 = decodeGrid('athens_t22e.sav');
    const idx = y * W + x;
    console.log(`  (${x.toString().padStart(4)},${y.toString().padStart(4)})  ${g0[idx].toString().padStart(2)}        ${g1[idx].toString().padStart(2)}        ${g5[idx].toString().padStart(2)}      ${g11[idx].toString().padStart(2)}        ${g22[idx].toString().padStart(2)}`);
  }
}

// ===== Maybe value encodes terrain cost? (Path cost for AI) =====
// Tiles with value 5+ might be impassable terrain or AI-cached high-cost cells.
// Check: total v=5+ in ror_t11e = 161,382. If it were terrain, it'd be stable.
// But it grew from 1,367 (T0) to 161k (T11). So it's NOT terrain.
// More likely interpretation: **AI threat / influence map** — these are tiles
// where the AI has computed something during turn processing. Player's
// "discovered enemy presence" maybe.

// Lemma check: relationship between v=0 -> v>=5 transition
console.log(`\n=== Transition matrix value(t1e) -> value(t11s) ===`);
{
  const a = decodeGrid('ror_t1e.sav');
  const b = decodeGrid('ror_t11s.sav');
  const trans = Array.from({length:8}, () => new Array(8).fill(0));
  for (let i = 0; i < W * H; i++) {
    const va = Math.min(7, a[i]);
    const vb = Math.min(7, b[i]);
    trans[va][vb]++;
  }
  console.log(`  rows = T1e value, cols = T11s value (incl 7+ all in column 7)`);
  const header = '       ' + Array.from({length:8}, (_, i)=>'v=' + i).map(x=>x.padStart(8)).join('');
  console.log(header);
  for (let i = 0; i < 8; i++) {
    const line = 'v=' + i + ' :  ' + trans[i].map(n => n.toString().padStart(8)).join('');
    console.log(line);
  }
}
