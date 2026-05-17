// Compare T2 baseline vs T2 after adoption — should add new character to family

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T2_BASE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 2.sav'));
const T2_ADOPT = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 2 adoption.sav'));

console.log('T2 base:     ' + T2_BASE.length);
console.log('T2 adoption: ' + T2_ADOPT.length);
console.log('Delta:       ' + (T2_ADOPT.length - T2_BASE.length));

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

const runs = diffRuns(T2_BASE, T2_ADOPT);
const byZone = {};
for (const r of runs) {
  const z = zoneOf(r.start);
  if (!byZone[z]) byZone[z] = [];
  byZone[z].push(r);
}

console.log('\n=== Diffs by zone (adoption save) ===');
for (const [zone, list] of Object.entries(byZone)) {
  console.log('  ' + zone.padEnd(20) + ' ' + list.length + ' runs');
}

// Focus on character-records zone — adoption should add character
console.log('\n=== Character-records zone diffs (0x4800..0x5400) ===');
const charDiffs = (byZone['character-records'] || []).filter(r => r.len <= 50);
console.log('Found ' + charDiffs.length + ' small diffs');
for (const r of charDiffs.slice(0, 30)) {
  const baseHex = Array.from(T2_BASE.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const newHex = Array.from(T2_ADOPT.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  0x' + r.start.toString(16) + ' len=' + r.len + ' base=[' + baseHex + '] → new=[' + newHex + ']');
}

// Look for NEW pstr16 ASCII strings that appear in adoption save (the adopted character's name)
// Search for name-like UTF-16 strings near the family records zone
console.log('\n=== UTF-16 pstr16 strings in 0x4800..0x5400 in adoption save (new character name?) ===');
const baseUtf16Strings = new Set();
const newUtf16Strings = new Set();

function findUtf16PstrsInRange(buf, start, end) {
  const strings = new Set();
  for (let p = start; p < end - 2; p++) {
    const len = buf.readUInt16LE(p);
    if (len < 3 || len > 30) continue;
    if (p + 2 + len * 2 > buf.length) continue;
    let allPrintable = true;
    const chars = [];
    for (let i = 0; i < len; i++) {
      const c = buf.readUInt16LE(p + 2 + i * 2);
      if (c < 0x20 || c > 0x7e) { allPrintable = false; break; }
      chars.push(String.fromCharCode(c));
    }
    if (allPrintable) {
      const s = chars.join('');
      if (/^[A-Z][a-zA-Z _]+$/.test(s)) {
        strings.add(s);
      }
    }
  }
  return strings;
}

const baseStrings = findUtf16PstrsInRange(T2_BASE, 0x4800, 0x5400);
const newStrings = findUtf16PstrsInRange(T2_ADOPT, 0x4800, 0x5400);
const addedStrings = [...newStrings].filter(s => !baseStrings.has(s));
console.log('Strings ADDED in adoption save:');
for (const s of addedStrings) console.log('  "' + s + '"');

// Also check the wider character-relevant zone
const baseStringsWide = findUtf16PstrsInRange(T2_BASE, 0x1000, 0x10000);
const newStringsWide = findUtf16PstrsInRange(T2_ADOPT, 0x1000, 0x10000);
const addedWide = [...newStringsWide].filter(s => !baseStringsWide.has(s));
console.log('\nStrings ADDED in adoption save (whole 0x1000-0x10000):');
for (const s of addedWide.slice(0, 20)) console.log('  "' + s + '"');
