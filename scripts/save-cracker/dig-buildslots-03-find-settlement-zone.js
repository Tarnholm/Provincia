// dig-buildslots-03-find-settlement-zone.js
// The 1311 default_set markers near 0xf8xxxx are NOT settlement building lists
// (no UTF-16 name precedes them). Find the REAL settlement building lists.
//
// Strategy: use buildingParser.findAllSettlementMarkers (the proven name-marker
// detector). For a few known macedon t0 settlements (Pella = capital, Thessalonica,
// etc.) report the name offset, then look at what default_set markers fall in the
// region around each name, and whether building chain names appear nearby.

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

// Find all settlement name markers
const markers = bp.findAllSettlementMarkers(buf);
console.log('settlement name markers: ' + markers.length);

// Find all building-chain pstr16 occurrences in whole file, group by chain
// (so we know where chain strings live overall)
const allChainHits = [];
for (let p = 0; p < buf.length - 4; p++) {
  const r = readPstr16Asciiz(buf, p);
  if (!r) continue;
  if (CHAIN_SET.has(r.str)) { allChainHits.push({ off: p, name: r.str }); p += r.totalLen - 1; }
}
console.log('total chain-name pstr16 hits in file: ' + allChainHits.length);
console.log('  span: 0x' + allChainHits[0].off.toString(16) + ' .. 0x' + allChainHits[allChainHits.length-1].off.toString(16));

// Show distribution of chain hits by 0x100000 buckets to locate the building zone
const buckets = {};
for (const h of allChainHits) {
  const bk = (h.off >> 20);
  buckets[bk] = (buckets[bk] || 0) + 1;
}
console.log('\nchain-hit count by 1MB bucket (bucket = off>>20):');
for (const [bk, c] of Object.entries(buckets).sort((a,b)=>parseInt(a[0])-parseInt(b[0]))) {
  console.log('  0x' + (parseInt(bk)<<20).toString(16).padStart(7,'0') + ' : ' + c);
}

// Where are settlement NAME markers? bucket distribution
const nbuckets = {};
for (const m of markers) { const bk = (m.offset>>20); nbuckets[bk]=(nbuckets[bk]||0)+1; }
console.log('\nsettlement-name marker count by 1MB bucket:');
for (const [bk, c] of Object.entries(nbuckets).sort((a,b)=>parseInt(a[0])-parseInt(b[0]))) {
  console.log('  0x' + (parseInt(bk)<<20).toString(16).padStart(7,'0') + ' : ' + c);
}

// Find Pella specifically
const pellas = markers.filter(m => m.name === 'Pella');
console.log('\nPella name markers: ' + pellas.map(m=>'0x'+m.offset.toString(16)).join(', '));
for (const pm of pellas) {
  // chain hits within +/- 4000 bytes of Pella name
  const near = allChainHits.filter(h => h.off > pm.offset - 4000 && h.off < pm.offset + 4000);
  console.log('  Pella @ 0x'+pm.offset.toString(16)+' nearby chain hits ('+near.length+'):');
  for (const h of near.slice(0, 40)) {
    console.log('    0x'+h.off.toString(16)+' ('+(h.off-pm.offset)+')  '+h.name);
  }
}
