// dig-pfact-3.js — Session 102/C
// Cross-save diff of the PLAYER faction record across three pairs:
//   (a) save_10_fresh.sav (T0 fresh) vs save_1.2.sav (mid-campaign)
//   (b) save_mp_before.sav vs save_mp_after.sav (1-tile move, same turn)
//   (c) ror_t1e.sav vs ror_t2s.sav (turn 1-end vs turn 2-start)
//
// Output per pair: list of (rel_offset, before_byte, after_byte) for each
// differing byte. Bucketed counts per 4KB window. Tiny diffs surface
// turn-state evolution.
//
// Also runs Step 5: numeric scans for known game state in the player record
// of save_1.2:
//   - treasury candidates near "10000.0 f32" or "0x2710 u32"
//   - year candidates: ±270, 270, 9, 10 (T-counter)
//   - net income -18334

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  if (!recs.length) return null;
  let big = recs[0];
  for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size) };
}

function diffPair(file_a, file_b, label) {
  const a = loadPlayer(file_a);
  const b = loadPlayer(file_b);
  if (!a || !b) { console.log(`\n=== ${label}: load failed ===`); return null; }
  console.log(`\n=== Diff ${label}: ${file_a} (${a.player.size} B) vs ${file_b} (${b.player.size} B) ===`);
  console.log(`Player offset A=0x${a.player.offset.toString(16)} B=0x${b.player.offset.toString(16)}; size delta=${b.player.size - a.player.size}`);
  console.log(`Total faction records: A=${a.recs.length} B=${b.recs.length}`);

  const minLen = Math.min(a.body.length, b.body.length);
  const diffs = [];
  let lastEnd = -2;
  let clusters = [];
  for (let i = 0; i < minLen; i++) {
    if (a.body[i] !== b.body[i]) {
      diffs.push(i);
      if (i === lastEnd + 1 && clusters.length) {
        clusters[clusters.length - 1].end = i;
      } else {
        clusters.push({ start: i, end: i });
      }
      lastEnd = i;
    }
  }
  console.log(`Total differing bytes (in common prefix of ${minLen}): ${diffs.length}`);
  console.log(`Diff clusters (contiguous runs): ${clusters.length}`);

  // Bucket diffs per 4KB window
  if (diffs.length) {
    const win = new Map();
    for (const i of diffs) {
      const k = i >> 12;
      win.set(k, (win.get(k) || 0) + 1);
    }
    const pairs = [...win.entries()].sort((a, b) => a[0] - b[0]);
    console.log(`Diff density per 4 KB window:`);
    for (const [w, c] of pairs) {
      console.log(`  win=${w.toString().padStart(3)}  rel=0x${(w*4096).toString(16).padStart(6,'0')}  ${c} diffs`);
    }
  }
  // Show first 30 clusters (compact)
  console.log(`First 30 diff clusters (offset, len, before -> after):`);
  for (const c of clusters.slice(0, 30)) {
    const len = c.end - c.start + 1;
    const ba = a.body.slice(c.start, c.end + 1).toString('hex');
    const bb = b.body.slice(c.start, c.end + 1).toString('hex');
    console.log(`  0x${c.start.toString(16).padStart(6,'0')}  len=${len}  ${ba} -> ${bb}`);
  }
  if (clusters.length > 30) {
    console.log(`  ... and ${clusters.length - 30} more clusters`);
  }
  return { clusters, diffs, a, b };
}

// --- Run the three pairs ---
diffPair('save_mp_before.sav', 'save_mp_after.sav', '1-tile move (tiny)');
diffPair('ror_t1e.sav', 'ror_t2s.sav', 'turn 1-end vs turn 2-start');
diffPair('save_10_fresh.sav', 'save_1.2.sav', 'T0 fresh vs mid-campaign');

// ===== Step 5: numeric scans on save_1.2 player record =====
console.log(`\n\n=== Step 5: numeric scans (save_1.2 player record) ===`);
const { body } = loadPlayer('save_1.2.sav');

function scanU32(target, label) {
  const hits = [];
  for (let i = 0; i + 4 <= body.length; i++) {
    if (body.readUInt32LE(i) === (target >>> 0)) hits.push(i);
  }
  console.log(`u32 ${label}=${target} (0x${(target>>>0).toString(16)}): ${hits.length} hit(s)${hits.length > 12 ? ` (showing first 12)` : ''}`);
  for (const h of hits.slice(0, 12)) {
    console.log(`  0x${h.toString(16).padStart(6,'0')}`);
  }
}

function scanI32(target, label) {
  const hits = [];
  for (let i = 0; i + 4 <= body.length; i++) {
    if (body.readInt32LE(i) === target) hits.push(i);
  }
  console.log(`i32 ${label}=${target}: ${hits.length} hit(s)${hits.length > 12 ? ` (showing first 12)` : ''}`);
  for (const h of hits.slice(0, 12)) {
    console.log(`  0x${h.toString(16).padStart(6,'0')}`);
  }
}

function scanF32(target, label, eps = 0.001) {
  const hits = [];
  for (let i = 0; i + 4 <= body.length; i++) {
    const v = body.readFloatLE(i);
    if (Math.abs(v - target) < eps) hits.push(i);
  }
  console.log(`f32 ${label}≈${target}: ${hits.length} hit(s)${hits.length > 12 ? ` (showing first 12)` : ''}`);
  for (const h of hits.slice(0, 12)) {
    console.log(`  0x${h.toString(16).padStart(6,'0')}`);
  }
}

// Treasury candidates
scanU32(10000, 'treasury candidate 10000');
scanF32(10000, 'treasury candidate 10000.0', 0.5);

// Net income -18334 reported in brief
scanI32(-18334, 'net income -18334');
scanF32(-18334, 'net income -18334 (f32)', 1.0);

// Year markers
scanI32(-270, 'year -270 (BC sign-flip)');
scanI32(270, 'year +270');

// Standard sentinels — sanity check
scanU32(0x3FC, 'header const 0x3FC (= 1020) — expected at +16');
scanU32(0x2BC, 'header const 0x2BC (=  700) — expected at +20');

// Save in JSON
// (no big output needed — text log is what matters)
console.log(`\nDone.`);
