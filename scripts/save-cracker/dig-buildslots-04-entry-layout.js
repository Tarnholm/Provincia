// dig-buildslots-04-entry-layout.js
// Dump the raw bytes of Pella's building chain entries to nail the entry layout
// and find the per-building LEVEL byte. Pella is Macedon's capital, so it has a
// rich roster (core_building at a high tier, government, etc.).

const fs = require('fs');
const path = require('path');
const bp = require(path.join('C:', 'dev', 'Provincia', 'src', 'buildingParser.js'));

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(SAVE_BASE, 'save_macedon t0.sav'));
const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';

function loadEdb() {
  const txt = fs.readFileSync(EDB, 'latin1');
  const lines = txt.split(/\r?\n/);
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
function hex(b, off, n) {
  return Array.from(b.slice(off, off + Math.min(n, b.length-off))).map(x => x.toString(16).padStart(2, '0')).join(' ');
}

const markers = bp.findAllSettlementMarkers(buf);
const pella = markers.find(m => m.name === 'Pella');
console.log('Pella name marker @ 0x' + pella.offset.toString(16) + '  blockEnd=0x' + pella.blockEnd.toString(16));

// Walk chain entries starting right after Pella's name block, find each chain
// pstr16, and dump the bytes between consecutive chain starts.
// First collect chain starts in a window after the name.
const winStart = pella.blockEnd;
const winEnd = pella.offset + 4000;
const starts = [];
for (let p = winStart; p < winEnd; p++) {
  const r = readPstr16Asciiz(buf, p);
  if (r && CHAIN_SET.has(r.str)) { starts.push({ off: p, name: r.str, totalLen: r.totalLen }); p += r.totalLen - 1; }
}
console.log('Chain entries found after Pella name: ' + starts.length);
console.log('Chains: ' + starts.map(s=>s.name).join(', '));

console.log('\n=== Per-entry byte dump (record = from this chain start to next chain start) ===');
for (let i = 0; i < starts.length; i++) {
  const s = starts[i];
  const nextOff = i+1 < starts.length ? starts[i+1].off : s.off + 90;
  const recLen = nextOff - s.off;
  const dataStart = s.off + s.totalLen; // first byte after "name\0"
  const lvls = CHAINS[s.name];
  console.log('\n[' + i + '] ' + s.name + '  (EDB levels: ' + lvls.length + ' = ' + lvls.join('/') + ')');
  console.log('     start=0x' + s.off.toString(16) + '  recLen=' + recLen + '  dataStart=+' + s.totalLen);
  // Dump full record bytes after the name, in 16-byte rows, with relative offset
  const dumpLen = Math.min(recLen - s.totalLen, 90);
  for (let j = 0; j < dumpLen; j += 16) {
    console.log('     +' + j.toString().padStart(3) + ': ' + hex(buf, dataStart + j, 16));
  }
}
