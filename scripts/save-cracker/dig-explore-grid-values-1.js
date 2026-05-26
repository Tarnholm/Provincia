// dig-explore-grid-values-1.js — exploration-grid value semantics, cross-turn
//
// GOAL: decode what values 0,1,2,3,4,5+ mean in the per-faction stride-2 RLE
// exploration grid at +0x18 of each faction record. Use the save_t0..save_t7
// sequential-turn series (same campaign) to see whether high values are
// transient (collapse to 1 next turn) = active LOS, or persistent = something
// structural.
//
// Method:
//  (1) Confirm each save is the same campaign + identify the player record
//      (largest faction record).
//  (2) Decode the player grid in each turn with the canonical count==0
//      terminator (matching main.js shipped logic).
//  (3) Per-turn value histogram.
//  (4) Cross-turn cell-level transitions: for value v in turn N, what is it
//      in turn N+1? (transient if v→1 dominates; persistent if v→v.)
//  (5) Monotonicity of "ever explored" = (value>=1).
//
// Diagnostics only. Does not modify app code.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const SAVES_DIR = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves';
const SERIES = ['save_t0.sav','save_t1.sav','save_t2.sav','save_t3.sav','save_t4.sav','save_t5.sav','save_t6.sav','save_t7.sav'];

const GRID_W = 510, GRID_H = 1400;
const RLE_REL = 0x18;

function campaignName(buf) {
  if (buf.length < 0x40) return '';
  const len = buf.readUInt16LE(0x3a);
  if (len <= 0 || len >= 64 || 0x3c + len * 2 > buf.length) return '';
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(0x3c + i * 2);
    if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
  }
  return s;
}

// Decode using the canonical count==0 terminator (matches main.js).
function decodePlayerGrid(buf) {
  const recs = findFactionRecords(buf);
  if (!recs.length) return null;
  let big = recs[0];
  for (const r of recs) if ((r.size||0) > (big.size||0)) big = r;
  const grid = new Uint8Array(GRID_W * GRID_H);
  const start = big.offset + RLE_REL;
  const max = Math.min(big.offset + big.size, buf.length);
  let gi = 0, i = start, pairs = 0;
  while (i + 2 <= max && gi < grid.length) {
    const val = buf[i], count = buf[i+1];
    if (count === 0) break;
    const lim = Math.min(count, grid.length - gi);
    for (let k = 0; k < lim; k++) grid[gi+k] = val;
    gi += lim; i += 2; pairs++;
  }
  return { grid, decoded: gi, pairs, recOff: big.offset, recSize: big.size, nRecs: recs.length, rleBytes: i - start };
}

function hist(grid) {
  const h = {};
  for (let i = 0; i < grid.length; i++) { const v = grid[i]; h[v] = (h[v]||0)+1; }
  return h;
}
function histStr(h) {
  return Object.keys(h).map(Number).sort((a,b)=>a-b)
    .map(v => `${v}:${h[v]}`).join('  ');
}

console.log('=== (1)+(2)+(3) per-turn decode + value histogram ===\n');
const grids = [];
for (const f of SERIES) {
  const p = path.join(SAVES_DIR, f);
  if (!fs.existsSync(p)) { console.log(`${f}  MISSING`); grids.push(null); continue; }
  const buf = fs.readFileSync(p);
  const camp = campaignName(buf);
  const g = decodePlayerGrid(buf);
  if (!g) { console.log(`${f}  no faction records`); grids.push(null); continue; }
  grids.push(g);
  const h = hist(g.grid);
  const high = Object.keys(h).map(Number).filter(v => v >= 2).reduce((a,v)=>a+h[v],0);
  console.log(`${f.padEnd(13)} camp=${camp} nRecs=${g.nRecs} playerRec@0x${g.recOff.toString(16)} size=${(g.recSize/1024).toFixed(0)}KB`);
  console.log(`   decoded=${g.decoded} pairs=${g.pairs} rleBytes=${g.rleBytes}`);
  console.log(`   hist: ${histStr(h)}`);
  console.log(`   value>=1 (everExplored)=${(h[1]||0) + high}   value>=2 (high/halo)=${high}`);
  console.log('');
}

// (4) Cross-turn transitions. For consecutive valid grids of equal length,
// build a transition table: how often does a cell with value vN become vN1?
console.log('=== (4) cross-turn cell transitions (turn N value -> turn N+1 value) ===');
console.log('    Focus: do high values (2..7) collapse to 1 (transient LOS) or persist?\n');
for (let t = 0; t + 1 < grids.length; t++) {
  const a = grids[t], b = grids[t+1];
  if (!a || !b) continue;
  if (a.grid.length !== b.grid.length) continue;
  // Transition counts keyed by (from,to). Only track cells where from>=2
  // OR to>=2 (the interesting high-value churn) plus the 1<->1 baseline.
  const trans = new Map();
  let everKept = 0, everLost = 0; // everExplored monotonicity check
  for (let i = 0; i < a.grid.length; i++) {
    const av = a.grid[i], bv = b.grid[i];
    if (av >= 1 && bv === 0) everLost++;
    if (av >= 1 && bv >= 1) everKept++;
    if (av >= 2 || bv >= 2) {
      const k = av + '->' + bv;
      trans.set(k, (trans.get(k)||0)+1);
    }
  }
  console.log(`${SERIES[t]} -> ${SERIES[t+1]}:`);
  console.log(`   everExplored(>=1): kept=${everKept}  LOST(reverted to 0)=${everLost}  (monotonic if LOST==0)`);
  // Summarize high-value churn: group by source value
  const bySrc = {};
  for (const [k,c] of trans) {
    const [from] = k.split('->').map(Number);
    (bySrc[from] = bySrc[from] || []).push([k,c]);
  }
  for (const from of Object.keys(bySrc).map(Number).sort((a,b)=>a-b)) {
    const rows = bySrc[from].sort((x,y)=>y[1]-x[1]);
    const total = rows.reduce((a,r)=>a+r[1],0);
    const top = rows.slice(0,6).map(([k,c])=>`${k.split('->')[1]}(${c})`).join(' ');
    console.log(`   from ${from} (n=${total}): -> ${top}`);
  }
  console.log('');
}

// (5) Does the high-value (>=2) count correlate with army/character count?
// Quick proxy: count type-6/type-4 character position records per save.
function countCharacters(buf) {
  let n = 0;
  for (let i = 100; i < buf.length - 64; i++) {
    const hdr = buf.readUInt32LE(i - 4);
    if (hdr !== 6 && hdr !== 4) continue;
    const u = buf.readUInt32LE(i);
    if (u === 0 || u === 0xffffffff) continue;
    const x = buf.readUInt32LE(i + 8);
    const y = buf.readUInt32LE(i + 12);
    if (x < 1 || x > 500 || y < 1 || y > 500) continue;
    const mp = buf.readFloatLE(i + 58);
    if (!isFinite(mp) || mp < 0 || mp > 1000) continue;
    n++;
  }
  return n;
}
console.log('=== (5) high-value count vs character count per turn ===');
for (let t = 0; t < SERIES.length; t++) {
  const g = grids[t];
  if (!g) continue;
  const buf = fs.readFileSync(path.join(SAVES_DIR, SERIES[t]));
  const h = hist(g.grid);
  const high = Object.keys(h).map(Number).filter(v => v >= 2).reduce((a,v)=>a+h[v],0);
  const nChar = countCharacters(buf);
  console.log(`   ${SERIES[t].padEnd(13)} chars(approx)=${nChar}  highCells(v>=2)=${high}  v1=${h[1]||0}`);
}
