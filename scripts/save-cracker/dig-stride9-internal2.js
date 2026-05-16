// dig-stride9-internal2.js — Session 99/G
// Investigate the 240-record stride-9 runs more carefully:
// - Verify the 0xf0 prefix byte
// - Identify what comes before the 0xf0 (e.g., known magic? faction record?)
// - Decode the 240 records: are they indexed 0..239?

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE);

const ZONE_START = 0x14e5ac6;
const ZONE_END = 0x20e6e8e;

function isStride9Rec(p) {
  if (p + 9 > buf.length) return false;
  if (buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) return false;
  const b3 = buf[p+3];
  return (b3 & 0x0f) === 0 && b3 <= 0x80;
}

// Find 240-record runs preceded by 0xf0
const runs = [];
let i = ZONE_START;
while (i < ZONE_END - 9) {
  if (isStride9Rec(i)) {
    let j = i;
    let count = 0;
    while (j + 9 <= ZONE_END && isStride9Rec(j)) { count++; j += 9; }
    if (count === 240) runs.push({ start: i, end: j, prev: buf[i-1] });
    i = j;
  } else {
    i++;
  }
}

console.log(`Found ${runs.length} runs of EXACTLY 240 records`);
const f0count = runs.filter(r => r.prev === 0xf0).length;
console.log(`  preceded by 0xf0: ${f0count}`);
console.log(`  other: ${runs.length - f0count}`);

// Look at first 6 runs: what's the 16 B before each?
console.log('\nFirst 6 runs preceded by 0xf0 — context around them:');
for (const r of runs.filter(rr => rr.prev === 0xf0).slice(0, 6)) {
  console.log(`\n  run @0x${r.start.toString(16)}:`);
  const pre = buf.slice(r.start - 32, r.start);
  console.log('    [-32..0]:  ' + pre.toString('hex'));
  // First 3 records
  console.log('    rec[0..2]: ' + buf.slice(r.start, r.start + 27).toString('hex'));
  // Last 3 records
  console.log('    rec[237..239]: ' + buf.slice(r.start + 237*9, r.start + 240*9).toString('hex'));
  // What comes right after?
  console.log('    [end..end+16]: ' + buf.slice(r.end, r.end + 16).toString('hex'));
}

// For each 240-record run, decode the first record. Is the xyz the same?
console.log('\n240-run distinct first-record xyz values:');
const firstXyzs = new Map();
for (const r of runs.filter(rr => rr.prev === 0xf0)) {
  const xyz = (buf[r.start] | (buf[r.start+1] << 8) | (buf[r.start+2] << 16)) >>> 0;
  firstXyzs.set(xyz, (firstXyzs.get(xyz) || 0) + 1);
}
const topX = [...firstXyzs.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10);
console.log('  Top 10 first-xyz:', topX.map(([x,c]) => `0x${x.toString(16)}×${c}`).join(' '));

// Are these records monotonic in xyz?
console.log('\nDoes xyz increase monotonically within a 240-run?');
{
  const sample = runs.filter(rr => rr.prev === 0xf0).slice(0, 3);
  for (const r of sample) {
    const xyzs = [];
    for (let k = 0; k < 240; k++) {
      const p = r.start + k * 9;
      xyzs.push((buf[p] | (buf[p+1] << 8) | (buf[p+2] << 16)) >>> 0);
    }
    let mono = true, monoDec = true;
    for (let k = 1; k < 240; k++) {
      if (xyzs[k] < xyzs[k-1]) mono = false;
      if (xyzs[k] > xyzs[k-1]) monoDec = false;
    }
    console.log(`  run @0x${r.start.toString(16)}: monotonicInc=${mono} monotonicDec=${monoDec}`);
    console.log(`    first 8 xyz: ${xyzs.slice(0, 8).map(x => '0x' + x.toString(16)).join(' ')}`);
    console.log(`    last 4 xyz:  ${xyzs.slice(-4).map(x => '0x' + x.toString(16)).join(' ')}`);
  }
}

// Distinct NN values per run?
console.log('\nDistinct NN values per 240-run (first 6 runs):');
{
  const sample = runs.filter(rr => rr.prev === 0xf0).slice(0, 6);
  for (const r of sample) {
    const nnHist = new Map();
    for (let k = 0; k < 240; k++) {
      const nn = buf[r.start + k * 9 + 3];
      nnHist.set(nn, (nnHist.get(nn) || 0) + 1);
    }
    const tops = [...nnHist].sort((a,b)=>b[1]-a[1]).slice(0, 5);
    console.log(`  @0x${r.start.toString(16)}: ${tops.map(([v,c]) => '0x'+v.toString(16)+'×'+c).join(' ')}`);
  }
}
