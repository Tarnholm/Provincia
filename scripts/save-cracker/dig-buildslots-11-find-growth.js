// dig-buildslots-11-find-growth.js
// Diff TWO saves' full settlement rosters (INVERSE/PREV association) and report
// every settlement whose building set or any building's level CHANGED. This is
// the cross-turn growth validation: constructing a building must appear as either
// a NEW chain or a LEVEL increment in exactly the settlement that built it.

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

function decodeAll(file) {
  const buf = fs.readFileSync(path.join(SAVE_BASE, file));
  const markers = bp.findAllSettlementMarkers(buf).sort((a, b) => a.offset - b.offset);
  // INVERSE: settlement i roster = chains in (markers[i-1].blockEnd , markers[i].offset)
  const out = new Map(); // name -> Map(chain -> levelName)  (first occurrence wins)
  for (let i = 0; i < markers.length; i++) {
    const prevEnd = i > 0 ? markers[i - 1].blockEnd : 0;
    const end = markers[i].offset;
    const m = new Map();
    for (let p = prevEnd; p < end; p++) {
      const r = readPstr16Asciiz(buf, p);
      if (r && CHAIN_SET.has(r.str)) {
        const dataStart = p + r.totalLen;
        const lvlByte = buf[dataStart + 4];
        const lvls = CHAINS[r.str] || [];
        if (!m.has(r.str)) m.set(r.str, lvls[lvlByte] !== undefined ? lvls[lvlByte] : ('?' + lvlByte));
        p += r.totalLen - 1;
      }
    }
    if (m.size && !out.has(markers[i].name)) out.set(markers[i].name, m);
  }
  return out;
}

const fileA = process.argv[2];
const fileB = process.argv[3];
const A = decodeAll(fileA);
const B = decodeAll(fileB);
console.log('A=' + fileA + '  settlements=' + A.size);
console.log('B=' + fileB + '  settlements=' + B.size);

let changed = 0;
for (const [city, mb] of B) {
  const ma = A.get(city);
  if (!ma) continue;
  const diffs = [];
  for (const [chain, lvl] of mb) {
    if (!ma.has(chain)) diffs.push('  + NEW   ' + chain + ' = ' + lvl);
    else if (ma.get(chain) !== lvl) diffs.push('  ^ LEVEL ' + chain + ': ' + ma.get(chain) + ' -> ' + lvl);
  }
  for (const [chain, lvl] of ma) {
    if (!mb.has(chain)) diffs.push('  - GONE  ' + chain + ' (' + lvl + ')');
  }
  if (diffs.length) {
    changed++;
    console.log('\n' + city + ':');
    for (const d of diffs) console.log(d);
  }
}
console.log('\nSettlements changed: ' + changed);
