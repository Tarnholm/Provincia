// Session 26 — Test hypothesis: idA = tile/cell index; consecutive idA = movement path.
// Per-hash consecutive idA Δ=1 sequences suggest character movement.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const START = 0x87e9, END = 0x2dca1;
const STRIDE = 12;
const N = (END - START) / STRIDE;
const recs = [];
for (let i = 0; i < N; i++) {
  const o = START + i*STRIDE;
  recs.push({
    i, o,
    flag: buf[o], sub: buf[o+1],
    idA: buf.readUInt16LE(o+2),
    idB: buf.readUInt16LE(o+4),
    z: buf.readUInt16LE(o+6),
    h: buf.readUInt32LE(o+8) >>> 0
  });
}

// Per-hash consecutive-idA-stride analysis
// Hypothesis: each "actor" has a sequence of records where idA represents tile index
// and consecutive entries are adjacent tiles (Δ=1 ≈ moving 1 tile per logged step)
// If idA = row*240 + col, then Δ=1 = move right, Δ=240 = move down

const hashRuns = {};
for (const r of recs) {
  if (r.h === 0) continue;
  if (!hashRuns[r.h]) hashRuns[r.h] = [];
  hashRuns[r.h].push(r);
}

// For each hash, find consecutive runs in record-order where idA strictly monotonic
const runLengths = [];
for (const [h, rs] of Object.entries(hashRuns)) {
  if (rs.length < 2) continue;
  // Sort by record index (file order already gives this)
  let run = 1;
  for (let i = 1; i < rs.length; i++) {
    if (rs[i].i === rs[i-1].i + 1) run++;
    else {
      if (run > 1) runLengths.push({h, len: run, start: rs[i-1].i - run + 1, year: rs[i-1].idB});
      run = 1;
    }
  }
  if (run > 1) runLengths.push({h, len: run, start: rs[rs.length-1].i - run + 1, year: rs[rs.length-1].idB});
}
console.log('Same-hash CONSECUTIVE-record runs (file order):', runLengths.length);
const runLenH = {};
for (const r of runLengths) runLenH[r.len] = (runLenH[r.len]||0)+1;
console.log('Run-length histogram:');
Object.entries(runLenH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([l,c])=>console.log('  len=' + l + ': ' + c));
const totalRecsInRuns = runLengths.reduce((s,r)=>s+r.len, 0);
console.log('Total records inside runs:', totalRecsInRuns, '/', recs.length);

// For each run of len>=3, examine idA strides — are they all Δ=1 (linear path)?
console.log('\n=== Examining idA strides within long runs (len>=5) ===');
const longRuns = runLengths.filter(r=>r.len>=5).slice(0, 20);
for (const run of longRuns) {
  const slice = recs.slice(run.start, run.start + run.len);
  const strides = [];
  for (let i = 1; i < slice.length; i++) strides.push(slice[i].idA - slice[i-1].idA);
  console.log('  hash=0x' + parseInt(run.h).toString(16).padStart(8,'0') + ' year=' + run.year + ' len=' + run.len + ' idA[0]=' + slice[0].idA + ' strides=' + strides.join(','));
}

// Stride histogram across all multi-step runs
console.log('\n=== idA stride histogram across all runs >=2 (top 20) ===');
const allStrides = {};
for (const run of runLengths) {
  const slice = recs.slice(run.start, run.start + run.len);
  for (let i = 1; i < slice.length; i++) {
    const s = slice[i].idA - slice[i-1].idA;
    allStrides[s] = (allStrides[s]||0)+1;
  }
}
Object.entries(allStrides).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([s,c])=>console.log('  Δ=' + s.padStart(6) + ': ' + c));

// If idA is a tile index, ranges 30..1020 are plausible (tile-grid is 240x238 = 57120 tiles)
// but max here is ~1016, suggesting it's NOT a 2D tile index
// Could be: settlement ID (we have ~195 settlements), region ID (213), or character ID
// Settlement count: brief mentions 1831 in descr_strat — but only 195 are unique X,Y pairs in save
// Region count: 213 regions
// Total entities: more than that

// What if idA % 240 = column, idA / 240 = row? Let me check spread
console.log('\n=== idA / 240 distribution (potential row if column-major) ===');
const rowH = {};
for (const r of recs) {
  if (r.h === 0) continue;
  const row = Math.floor(r.idA / 240);
  rowH[row] = (rowH[row]||0)+1;
}
console.log('Rows:', Object.keys(rowH).length, 'top:', Object.entries(rowH).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([r,c])=>'row'+r+'='+c).join(' '));
// If idA goes 0..1020, then row 0..4 in a 240-wide layout — that's a thin band, doesn't fit tile-grid

// More likely: idA is in a different coordinate space, e.g. a 32-wide one
// Try idA / 32, idA / 64, idA / 128
for (const div of [16, 32, 64, 128]) {
  const h = {};
  for (const r of recs) {
    if (r.h===0) continue;
    h[Math.floor(r.idA/div)] = (h[Math.floor(r.idA/div)]||0)+1;
  }
  console.log('  div=' + div + ': ' + Object.keys(h).length + ' bins');
}

// Per-hash total record count distribution
const hashCounts = Object.entries(hashRuns).map(([h,rs])=>rs.length).sort((a,b)=>b-a);
console.log('\n=== Per-hash record counts ===');
console.log('Total hashes (excl zero):', hashCounts.length);
console.log('Top 20:', hashCounts.slice(0,20).join(' '));
console.log('Sum top 20:', hashCounts.slice(0,20).reduce((a,b)=>a+b,0));
console.log('Hashes with >=10 records:', hashCounts.filter(c=>c>=10).length);
console.log('Hashes with >=3 records:', hashCounts.filter(c=>c>=3).length);
console.log('Hashes with 1 record only:', hashCounts.filter(c=>c===1).length);

// Year-span per hash: how many years does each hash appear in?
console.log('\n=== Year-span per top hash (top 10 by record count) ===');
const topHashes = Object.entries(hashRuns).sort((a,b)=>b[1].length-a[1].length).slice(0,10);
for (const [h, rs] of topHashes) {
  const years = new Set(rs.map(r=>r.idB));
  const minY = Math.min(...years), maxY = Math.max(...years);
  console.log('  hash=0x' + parseInt(h).toString(16).padStart(8,'0') + ' n=' + rs.length + ' years: ' + minY + '..' + maxY + ' (' + years.size + ' distinct, span ' + (maxY-minY) + ')');
}

// Are some hashes "born" later than others? (= character appearing later in game)
console.log('\n=== Hash first-year vs last-year ===');
const hashLife = {};
for (const r of recs) {
  if (r.h === 0) continue;
  if (!hashLife[r.h]) hashLife[r.h] = {min: r.idB, max: r.idB, count: 1};
  else {
    hashLife[r.h].min = Math.min(hashLife[r.h].min, r.idB);
    hashLife[r.h].max = Math.max(hashLife[r.h].max, r.idB);
    hashLife[r.h].count++;
  }
}
// Bucket by first-year
const firstYearH = {};
for (const [h,l] of Object.entries(hashLife)) firstYearH[l.min] = (firstYearH[l.min]||0)+1;
console.log('First-year (= year hash first appears) histogram top 10:');
Object.entries(firstYearH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).slice(0,10).forEach(([y,c])=>console.log('  first_year=' + y + ': ' + c + ' hashes'));
console.log('Hashes with first_year=275 (game start):', firstYearH[275] || 0);

// Death years (= last appearance):
const lastYearH = {};
for (const [h,l] of Object.entries(hashLife)) lastYearH[l.max] = (lastYearH[l.max]||0)+1;
console.log('Last-year histogram top 10:');
Object.entries(lastYearH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).reverse().slice(0,10).forEach(([y,c])=>console.log('  last_year=' + y + ': ' + c + ' hashes'));

// If hash = character/army UUID and idA = position, then a single year = one record per movement step
// would mean characters move 11-step paths in one year. That's plausible — Roman generals could move 10-15 tiles
// per turn.
//
// Or — could this be the CHARACTER_PATH cache? Session 25 said character_paths sections are at 0xa8beb..0xf8f9b
// But those are SEPARATE sections, not this flat array.
//
// Or — could idA be the "intended-path" tile sequence, like the trail array in session 23's lua footer?
// That had 1198 records with 122 non-zero pairs. The shape doesn't match.

// Strong test: are the consecutive-idA runs always WITHIN a single year? (= same-turn movement)
const runsByYearChange = { sameYear: 0, diffYear: 0 };
for (const run of runLengths) {
  const slice = recs.slice(run.start, run.start + run.len);
  const years = new Set(slice.map(r=>r.idB));
  if (years.size === 1) runsByYearChange.sameYear++;
  else runsByYearChange.diffYear++;
}
console.log('\nMulti-step runs: same-year=' + runsByYearChange.sameYear + ', mixed-year=' + runsByYearChange.diffYear);
