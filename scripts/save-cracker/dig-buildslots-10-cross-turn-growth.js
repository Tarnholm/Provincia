// dig-buildslots-10-cross-turn-growth.js
// Validate the current-buildings decode by tracking ONE settlement across the
// arretium construction save series. As the player constructs buildings turn by
// turn, the decoded roster (chain + level) must grow / level-up monotonically.
//
// Uses the INVERSE/PREV association resolved in dig-buildslots-08: a settlement's
// roster = chains between the PREVIOUS name marker's blockEnd and THIS marker's
// offset.
//
// Layout (confirmed dig-buildslots-09):
//   record = [u16 len][ASCII chain name][\0][4-byte hash][u32 LEVEL][...]
//   LEVEL field at dataStart+4 (little-endian u32; only low byte ever used).

const fs = require('fs');
const path = require('path');
const bp = require(path.join('C:', 'dev', 'Provincia', 'src', 'buildingParser.js'));

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';

function loadEdb() {
  const txt = fs.readFileSync(EDB, 'latin1'); const lines = txt.split(/\r?\n/);
  let cur = null; const chains = {};
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '');
    let m = line.match(/^building\s+(\w+)/);
    if (m) { cur = m[1]; chains[cur] = []; continue; }
    m = line.match(/^\s+levels\s+(.+)$/);
    if (m && cur) chains[cur] = m[1].trim().split(/\s+/).filter(Boolean);
  }
  return chains;
}
const CHAINS = loadEdb();
const CHAIN_SET = new Set(Object.keys(CHAINS));

function readPstr16Asciiz(b, off) {
  if (off + 2 > b.length) return null;
  const lenP1 = b.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > b.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) { const c = b[off + 2 + j]; if (c < 0x20 || c > 0x7e) return null; }
  if (b[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: b.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

function decodeCity(file, city) {
  const buf = fs.readFileSync(path.join(SAVE_BASE, file));
  const markers = bp.findAllSettlementMarkers(buf).sort((a, b) => a.offset - b.offset);
  // pick the FIRST marker with the given name (player city)
  const idx = markers.findIndex(m => m.name === city);
  if (idx < 0) return null;
  const prevEnd = idx > 0 ? markers[idx - 1].blockEnd : 0;
  const end = markers[idx].offset;
  const roster = [];
  for (let p = prevEnd; p < end; p++) {
    const r = readPstr16Asciiz(buf, p);
    if (r && CHAIN_SET.has(r.str)) {
      const dataStart = p + r.totalLen;
      const lvlByte = buf[dataStart + 4];
      const lvls = CHAINS[r.str] || [];
      roster.push({ name: r.str, level: lvlByte, levelName: lvls[lvlByte] !== undefined ? lvls[lvlByte] : ('?' + lvlByte) });
      p += r.totalLen - 1;
    }
  }
  return roster;
}

const series = [
  ['save_arretium pre retrained..sav', 'Arretium'],
  ['save_arretium retrained turn 2.sav', 'Arretium'],
  ['save_arretium turn 3.sav', 'Arretium'],
  ['save_arretium turn 4.sav', 'Arretium'],
];

let prev = null;
for (const [file, city] of series) {
  const roster = decodeCity(file, city);
  console.log('\n=== ' + file + '  (' + city + ') ===');
  if (!roster) { console.log('  (city not found)'); continue; }
  const m = new Map(roster.map(r => [r.name, r.levelName]));
  for (const r of roster) {
    let tag = '';
    if (prev) {
      if (!prev.has(r.name)) tag = '  <== NEW CHAIN';
      else if (prev.get(r.name) !== r.levelName) tag = '  <== LEVEL ' + prev.get(r.name) + ' -> ' + r.levelName;
    }
    console.log('   ' + r.name.padEnd(30) + ' ' + r.levelName + tag);
  }
  prev = m;
}
