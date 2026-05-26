// dig-buildslots-09-arretium-deep.js
// Deep-dive Arretium in macedon t0 to resolve the residual level discrepancy
// (descr_strat says mic_1, our decode says mic_2) and confirm the level byte.
//
// We use the INVERSE/PREV association (resolved in -08): a settlement's roster is
// the chains BETWEEN the previous name marker's blockEnd and THIS marker's offset.
// Arretium is marker index 1 (after Rome). So Arretium's TRUE roster lives between
// Rome.blockEnd and Arretium.offset.
//
// Dump every chain pstr16 in that window with its full record bytes, the level
// byte candidates (+4, and a few neighbours), so we can see exactly which offset
// holds the level and whether mic appears once or twice (template vs live list).

const fs = require('fs');
const path = require('path');
const bp = require(path.join('C:', 'dev', 'Provincia', 'src', 'buildingParser.js'));

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';
const buf = fs.readFileSync(path.join(SAVE_BASE, process.argv[2] || 'save_macedon t0.sav'));
const CITY = process.argv[3] || 'Arretium';

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
function hex(b, off, n) {
  return Array.from(b.slice(off, off + Math.min(n, b.length - off))).map(x => x.toString(16).padStart(2, '0')).join(' ');
}

const markers = bp.findAllSettlementMarkers(buf).sort((a, b) => a.offset - b.offset);
const idx = markers.findIndex(m => m.name === CITY);
console.log('city=' + CITY + ' markerIndex=' + idx + '  offset=0x' + markers[idx].offset.toString(16) + '  blockEnd=0x' + markers[idx].blockEnd.toString(16));
const prevEnd = idx > 0 ? markers[idx - 1].blockEnd : 0;
console.log('prev marker="' + (idx > 0 ? markers[idx - 1].name : '(start)') + '" blockEnd=0x' + prevEnd.toString(16));
console.log('PREV window (TRUE roster per INVERSE model): 0x' + prevEnd.toString(16) + ' .. 0x' + markers[idx].offset.toString(16) + '  (' + (markers[idx].offset - prevEnd) + ' bytes)');

// Walk all chain pstr16 in the PREV window
const win = [];
for (let p = prevEnd; p < markers[idx].offset; p++) {
  const r = readPstr16Asciiz(buf, p);
  if (r && CHAIN_SET.has(r.str)) { win.push({ off: p, name: r.str, totalLen: r.totalLen }); p += r.totalLen - 1; }
}
console.log('\nChains in PREV window: ' + win.length);
for (let i = 0; i < win.length; i++) {
  const s = win[i];
  const next = i + 1 < win.length ? win[i + 1].off : markers[idx].offset;
  const recLen = next - s.off;
  const dataStart = s.off + s.totalLen;
  const lvls = CHAINS[s.name];
  const lb = buf[dataStart + 4];
  console.log('\n[' + i + '] ' + s.name + '  recLen=' + recLen + '  (EDB levels ' + lvls.length + ' = ' + lvls.join('/') + ')');
  console.log('     start=0x' + s.off.toString(16) + '  dataStart=0x' + dataStart.toString(16));
  console.log('     +4 LEVEL byte = ' + lb + '  -> ' + (lvls[lb] !== undefined ? lvls[lb] : '!!OOR'));
  console.log('     data +0..15 : ' + hex(buf, dataStart, 16));
  console.log('     data +16..31: ' + hex(buf, dataStart + 16, 16));
}
