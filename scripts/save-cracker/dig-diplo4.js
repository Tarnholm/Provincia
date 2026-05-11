#!/usr/bin/env node
// Diplomacy state probe — Macedon Turn 97 vs 98 End vs 99 Start.
// Method: find Macedon's minor-faction record across saves; identify byte changes
// that correlate with diplomatic transitions.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const saves = [
  'save_Autosave   Macedon   Turn 97.sav',
  'save_Autosave   Macedon   Turn 98 End.sav',
  'save_Autosave   Macedon   Turn 99 Start.sav',
];

function findMinor(buf) {
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 8) continue;
    return i;
  }
  return -1;
}

const bufs = saves.map(s => fs.readFileSync(path.join(dir, s)));
const macedonPos = bufs.map(findMinor);

console.log('Macedon minor-faction record positions:');
for (let i = 0; i < saves.length; i++) {
  console.log(`  ${saves[i]}: 0x${macedonPos[i].toString(16)}, treasury=${bufs[i].readInt32LE(macedonPos[i])}`);
}

// Scan from Macedon record onward for diff-able bytes (excluding runtime-pointer-shaped)
const RECORD_SIZE = 7000; // expected size based on session 7's Sparta size
console.log(`\n=== Diff Macedon record interior (97 vs 98 End) ===`);
const a = bufs[0];
const b = bufs[1];
const aPos = macedonPos[0];
const bPos = macedonPos[1];

const diffs = [];
for (let j = 0; j < RECORD_SIZE; j++) {
  if (aPos + j >= a.length || bPos + j >= b.length) break;
  if (a[aPos + j] !== b[bPos + j]) {
    diffs.push(j);
  }
}
console.log(`Diffs in first ${RECORD_SIZE} bytes: ${diffs.length}`);

// Group consecutive diffs into runs
const runs = [];
let run = null;
for (const d of diffs) {
  if (run && d === run.end) {
    run.end = d + 1;
  } else {
    if (run) runs.push(run);
    run = { start: d, end: d + 1 };
  }
}
if (run) runs.push(run);

console.log(`Diff runs: ${runs.length}`);
for (const r of runs.slice(0, 50)) {
  const len = r.end - r.start;
  const aHex = a.slice(aPos + r.start, aPos + r.end).toString('hex');
  const bHex = b.slice(bPos + r.start, bPos + r.end).toString('hex');
  // Interpret as u32 if length is 4
  let interp = '';
  if (len === 4) {
    const aV = a.readUInt32LE(aPos + r.start);
    const bV = b.readUInt32LE(bPos + r.start);
    interp = ` u32 ${aV}→${bV} (delta ${bV-aV})`;
  } else if (len <= 2) {
    interp = ` (byte ${a[aPos+r.start]}→${b[bPos+r.start]})`;
  }
  console.log(`  +${r.start.toString().padStart(4)} len=${len.toString().padStart(2)}: A=${aHex} B=${bHex}${interp}`);
}

// Same for 98 End vs 99 Start
console.log(`\n=== Diff Macedon record interior (98 End vs 99 Start) ===`);
const a2 = bufs[1];
const b2 = bufs[2];
const aPos2 = macedonPos[1];
const bPos2 = macedonPos[2];

const diffs2 = [];
for (let j = 0; j < RECORD_SIZE; j++) {
  if (aPos2 + j >= a2.length || bPos2 + j >= b2.length) break;
  if (a2[aPos2 + j] !== b2[bPos2 + j]) {
    diffs2.push(j);
  }
}
console.log(`Diffs in first ${RECORD_SIZE} bytes: ${diffs2.length}`);

const runs2 = [];
let run2 = null;
for (const d of diffs2) {
  if (run2 && d === run2.end) {
    run2.end = d + 1;
  } else {
    if (run2) runs2.push(run2);
    run2 = { start: d, end: d + 1 };
  }
}
if (run2) runs2.push(run2);

for (const r of runs2.slice(0, 50)) {
  const len = r.end - r.start;
  const aHex = a2.slice(aPos2 + r.start, aPos2 + r.end).toString('hex');
  const bHex = b2.slice(bPos2 + r.start, bPos2 + r.end).toString('hex');
  let interp = '';
  if (len === 4) {
    const aV = a2.readUInt32LE(aPos2 + r.start);
    const bV = b2.readUInt32LE(bPos2 + r.start);
    interp = ` u32 ${aV}→${bV} (delta ${bV-aV})`;
  } else if (len <= 2) {
    interp = ` (byte ${a2[aPos2+r.start]}→${b2[bPos2+r.start]})`;
  }
  console.log(`  +${r.start.toString().padStart(4)} len=${len.toString().padStart(2)}: A=${aHex} B=${bHex}${interp}`);
}
