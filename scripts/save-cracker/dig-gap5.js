// dig-gap5.js — sample many records' first 97 bytes. Are they all identical?
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const REC_START = 0x633c50;
const STRIDE = 267;
const DATA = 97;  // non-zero block length per record
const N = 36582;  // confirmed count

// Hash each record's data block, count distinct
const crypto = require('crypto');
const hashes = new Map();  // hex -> count
const idxByHash = new Map(); // hex -> first index
for (let i = 0; i < N; i++) {
  const rs = REC_START + i * STRIDE;
  const h = crypto.createHash('md5').update(buf.slice(rs, rs + DATA)).digest('hex');
  hashes.set(h, (hashes.get(h) || 0) + 1);
  if (!idxByHash.has(h)) idxByHash.set(h, i);
}
console.log(`distinct record data signatures: ${hashes.size}`);
const sorted = [...hashes.entries()].sort((a,b) => b[1]-a[1]);
console.log(`top 10 most common:`);
sorted.slice(0,10).forEach(([h,c]) => {
  const i = idxByHash.get(h);
  console.log(`  count=${c.toString().padStart(6)}  firstIdx=${i.toString().padStart(6)}  hash=${h.slice(0,16)}...`);
});

// Are records grouped contiguously by signature? Look at runs.
let runs = [];
let cur = null;
for (let i = 0; i < N; i++) {
  const rs = REC_START + i * STRIDE;
  const h = crypto.createHash('md5').update(buf.slice(rs, rs + DATA)).digest('hex');
  if (!cur || cur.h !== h) {
    if (cur) runs.push(cur);
    cur = { h, from: i, to: i+1 };
  } else cur.to = i+1;
}
if (cur) runs.push(cur);
console.log(`\ndistinct contiguous runs by signature: ${runs.length}`);
console.log(`first 20 runs:`);
runs.slice(0,20).forEach(r => console.log(`  i=${r.from}..${r.to-1} (len=${r.to-r.from}) sig=${r.h.slice(0,12)}`));
console.log(`...`);
console.log(`last 10 runs:`);
runs.slice(-10).forEach(r => console.log(`  i=${r.from}..${r.to-1} (len=${r.to-r.from}) sig=${r.h.slice(0,12)}`));

// Run-length stats
const runLens = runs.map(r => r.to - r.from).sort((a,b)=>a-b);
console.log(`\nrun lengths: min=${runLens[0]}, max=${runLens[runLens.length-1]}, median=${runLens[Math.floor(runLens.length/2)]}, mean=${(runLens.reduce((a,b)=>a+b,0)/runLens.length).toFixed(1)}`);

// Now: hypothesis check.  36582 records, structured by run-length distribution.
// If 36582 ÷ run_length_modal = num distinct groups, that may equal 239 (factions) or 199 (regions in RIS).
const modes = {};
for (const l of runLens) modes[l] = (modes[l]||0)+1;
const topModes = Object.entries(modes).sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log(`top run-length modes: ${topModes.map(([l,c])=>`${l}×${c}`).join(', ')}`);

// Find some non-trivial records (changing data)
console.log(`\n=== first 6 records with distinct signatures ===`);
let seen = new Set();
let shown = 0;
for (let i = 0; i < N && shown < 6; i++) {
  const rs = REC_START + i * STRIDE;
  const h = crypto.createHash('md5').update(buf.slice(rs, rs + DATA)).digest('hex');
  if (seen.has(h)) continue;
  seen.add(h);
  const slice = buf.slice(rs, rs + DATA);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(`record ${i} @ 0x${rs.toString(16)}:`);
  console.log(`  hex: ${hex.slice(0, 150)}...`);
  console.log(`  asc: ${asc}`);
  shown++;
}
