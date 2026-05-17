// Compare T7 saves to find governor assignment bytes

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T7_PREV = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 7 merge units.sav'));
const T7_GOV = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 7 New Governour in Sparta.sav'));

console.log('T7 merge units:    ' + T7_PREV.length);
console.log('T7 new gov Sparta: ' + T7_GOV.length);
console.log('Delta: ' + (T7_GOV.length - T7_PREV.length));

function zoneOf(off) {
  if (off < 0x1000) return 'header';
  if (off < 0x1190) return 'section-registry';
  if (off < 0x14a0) return 'owner-table';
  if (off < 0x4800) return 'event-log';
  if (off < 0x5400) return 'character-records';
  if (off < 0x5cf0) return 'historic-events';
  if (off < 0x7b88) return 'tile-events';
  if (off < 0x7c20) return 'wonders';
  if (off < 0xcff0) return 'polygons';
  if (off < 0x1943f) return 'diplomacy';
  if (off < 0x37000) return 'settlements';
  if (off < 0x3e000) return 'merc-pools';
  return 'units';
}

function diffRuns(a, b) {
  const len = Math.min(a.length, b.length);
  const runs = [];
  let runStart = -1;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        runs.push({ start: runStart, end: i - 1, len: i - runStart });
        runStart = -1;
      }
    }
  }
  if (runStart !== -1) runs.push({ start: runStart, end: len - 1, len: len - runStart });
  return runs;
}

const runs = diffRuns(T7_PREV, T7_GOV);
const byZone = {};
for (const r of runs) {
  const z = zoneOf(r.start);
  if (!byZone[z]) byZone[z] = [];
  byZone[z].push(r);
}

console.log('\n=== Diffs by zone ===');
for (const [zone, list] of Object.entries(byZone)) {
  console.log('  ' + zone.padEnd(20) + ' ' + list.length + ' runs');
}

// Focus on settlements zone (governor goes to Sparta)
console.log('\n=== Settlement zone diffs (small runs only) ===');
const setDiffs = (byZone['settlements'] || []).filter(r => r.len <= 16);
console.log('Total small settlement diffs: ' + setDiffs.length);
// Group nearby diffs (within 1000 bytes)
const groups = [];
let curGroup = [];
for (const r of setDiffs) {
  if (curGroup.length === 0 || r.start - curGroup[curGroup.length-1].start < 1000) {
    curGroup.push(r);
  } else {
    if (curGroup.length > 0) groups.push(curGroup);
    curGroup = [r];
  }
}
if (curGroup.length > 0) groups.push(curGroup);
console.log('Diff clusters: ' + groups.length);
console.log('Top 10 clusters by size:');
groups.sort((a, b) => b.length - a.length);
for (const g of groups.slice(0, 10)) {
  console.log('  Cluster at 0x' + g[0].start.toString(16) + '..0x' + g[g.length-1].end.toString(16) + ' (' + g.length + ' diffs)');
  for (const r of g.slice(0, 3)) {
    const baseHex = Array.from(T7_PREV.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const newHex = Array.from(T7_GOV.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log('    0x' + r.start.toString(16) + ' len=' + r.len + ': [' + baseHex + '] → [' + newHex + ']');
  }
}

// Find Sparta in both saves and look at the diff around it
function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

const spartaPrev = findUtf16(T7_PREV, 'Sparta');
const spartaGov = findUtf16(T7_GOV, 'Sparta');
console.log('\nSparta in T7 prev: 0x' + spartaPrev.toString(16));
console.log('Sparta in T7 gov:  0x' + spartaGov.toString(16));
// Look at diff specifically near Sparta
const startRange = spartaPrev - 1000;
const endRange = spartaPrev + 2000;
const nearSparta = runs.filter(r => r.start >= startRange && r.start < endRange && r.len <= 8);
console.log('\nDiffs near Sparta (0x' + startRange.toString(16) + '..0x' + endRange.toString(16) + '):');
for (const r of nearSparta.slice(0, 20)) {
  const baseHex = Array.from(T7_PREV.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(T7_GOV.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  0x' + r.start.toString(16) + ' (Sparta+' + (r.start - spartaPrev) + ') len=' + r.len + ': [' + baseHex + '] → [' + newHex + ']');
}
