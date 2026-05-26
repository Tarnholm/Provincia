// dig-buildslots-05-decode-all.js
// Full decoder of every settlement's CURRENT-BUILDINGS list with per-building
// LEVEL, validated against EDB. Reports level index -> level name.
//
// CONFIRMED ENTRY LAYOUT (from dig-buildslots-04):
//   record start = pstr16 ASCIIZ chain name [u16 len][name][\0]
//   +0 (after name\0) : 4-byte hash
//   +4               : u8 LEVEL  (0-based index into EDB chain.levels)
//   +5..             : per-level state (turns, health 0x64=100 at +29, 0xef at +49 ...)
//   record length is variable (~90-330 bytes) -> next record = next chain pstr16
//
// Settlement model (this Rome save): chains appear AFTER the settlement UTF-16
// name marker, up to the next settlement name. The chains immediately following
// a name belong to that settlement.

const fs = require('fs');
const path = require('path');
const bp = require(path.join('C:', 'dev', 'Provincia', 'src', 'buildingParser.js'));

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';
const saveArg = process.argv[2] || 'save_macedon t0.sav';
const buf = fs.readFileSync(path.join(SAVE_BASE, saveArg));

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

// All settlement name markers (sorted by offset)
const markers = bp.findAllSettlementMarkers(buf).sort((a, b) => a.offset - b.offset);

// All chain pstr16 hits in file (sorted)
const chainHits = [];
for (let p = 0; p < buf.length - 4; p++) {
  const r = readPstr16Asciiz(buf, p);
  if (!r) continue;
  if (CHAIN_SET.has(r.str)) { chainHits.push({ off: p, name: r.str, totalLen: r.totalLen }); p += r.totalLen - 1; }
}

// For each settlement (by name marker), grab chain hits between this marker's
// blockEnd and the next marker's offset.
function decodeLevel(name, off, totalLen) {
  const dataStart = off + totalLen;
  const lvlByte = buf[dataStart + 4];
  const lvls = CHAINS[name] || [];
  let levelName = null, valid = false;
  if (lvlByte < lvls.length) { levelName = lvls[lvlByte]; valid = true; }
  return { lvlByte, levelName, valid, maxLevels: lvls.length };
}

const out = [];
for (let i = 0; i < markers.length; i++) {
  const m = markers[i];
  const next = i + 1 < markers.length ? markers[i + 1].offset : buf.length;
  const local = chainHits.filter(h => h.off >= m.blockEnd && h.off < next);
  if (local.length === 0) continue;
  const buildings = local.map(h => {
    const d = decodeLevel(h.name, h.off, h.totalLen);
    return { name: h.name, off: h.off, ...d };
  });
  out.push({ name: m.name, offset: m.offset, buildings });
}

// ---- Validation summary ----
let total = 0, invalid = 0;
const invalidSamples = [];
for (const s of out) for (const b of s.buildings) {
  total++;
  if (!b.valid) { invalid++; if (invalidSamples.length < 30) invalidSamples.push({ s: s.name, b }); }
}
console.log('SAVE: ' + saveArg);
console.log('Settlements with buildings: ' + out.length);
console.log('Total building entries: ' + total + '   level-valid: ' + (total - invalid) + '   INVALID: ' + invalid);

console.log('\n=== Sample settlements (first 12) ===');
for (const s of out.slice(0, 12)) {
  console.log('\n' + s.name + '  (0x' + s.offset.toString(16) + ')  [' + s.buildings.length + ' chains]');
  for (const b of s.buildings) {
    console.log('   ' + b.name.padEnd(30) + ' lvlByte=' + String(b.lvlByte).padStart(3) +
      '  ->  ' + (b.levelName || '!!INVALID(max ' + b.maxLevels + ')') );
  }
}

if (invalidSamples.length) {
  console.log('\n=== INVALID level samples ===');
  for (const x of invalidSamples) {
    console.log('  ' + x.s + ' / ' + x.b.name + ' lvlByte=' + x.b.lvlByte + ' maxLevels=' + x.b.maxLevels);
  }
}

// Export for diff scripts
module.exports = { out, CHAINS };
