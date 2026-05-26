// dig-buildslots-08-resolve-direction-and-levels.js
// DEFINITIVELY resolve:
//   (1) FORWARD vs INVERSE association (does the chain roster after name marker N
//       belong to settlement N, or to N+1 / N-1?)
//   (2) Whether the per-building LEVEL byte (dataStart+4) is exactly correct.
//
// Method: macedon t0 save = player faction Macedon at turn 0, so EVERY settlement's
// roster should match descr_strat EXACTLY (chain + level), no construction yet.
// For each name marker we look up the city -> region -> descr_strat signature
// (chain=level set) and compute exact-match jaccard for THREE candidate rosters:
//   FWD  : chains in (marker[i].blockEnd , marker[i+1].offset)
//   PREV : chains in (marker[i-1].blockEnd , marker[i].offset)
//   SELF : chains in (marker[i].offset start-of-its-own-block ... ) -- N/A, listed for completeness
// Whichever candidate matches the marker's OWN city best is the correct direction.

const fs = require('fs');
const path = require('path');
const bp = require(path.join('C:', 'dev', 'Provincia', 'src', 'buildingParser.js'));

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';
const DSTRAT = 'C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt';
const DREGIONS = 'C:\\RIS\\RIS\\data\\world\\maps\\base\\descr_regions.txt';
const buf = fs.readFileSync(path.join(SAVE_BASE, process.argv[2] || 'save_macedon t0.sav'));

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

// region -> first settlement name in descr_regions
function loadRegions() {
  const txt = fs.readFileSync(DREGIONS, 'latin1'); const lines = txt.split(/\r?\n/);
  const city2region = {};
  for (let i = 0; i < lines.length; i++) {
    const rawHdr = lines[i].replace(/;.*$/, '');
    if (/^[A-Z][A-Za-z0-9_'-]+$/.test(rawHdr) && !/^\s/.test(lines[i])) {
      const region = rawHdr.trim();
      let j = i + 1;
      while (j < lines.length && lines[j].replace(/;.*$/, '').trim() === '') j++;
      const city = lines[j] ? lines[j].replace(/;.*$/, '').trim() : null;
      if (city && /^[A-Za-z]/.test(city)) city2region[city] = region;
    }
  }
  return city2region;
}
const city2region = loadRegions();

function loadDescrStrat() {
  const txt = fs.readFileSync(DSTRAT, 'latin1'); const lines = txt.split(/\r?\n/);
  const region2sig = {}; let cur = null;
  for (const raw of lines) {
    const l = raw.replace(/;.*$/, '');
    let m = l.match(/^\s*region\s+(\w+)/);
    if (m) { cur = m[1]; region2sig[cur] = new Set(); continue; }
    m = l.match(/^\s*type\s+(\w+)\s+(\S+)/);
    if (m && cur) region2sig[cur].add(m[1] + '=' + m[2]);
  }
  return region2sig;
}
const region2sig = loadDescrStrat();

function readPstr16Asciiz(b, off) {
  if (off + 2 > b.length) return null;
  const lenP1 = b.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > b.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) { const c = b[off + 2 + j]; if (c < 0x20 || c > 0x7e) return null; }
  if (b[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: b.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

const markers = bp.findAllSettlementMarkers(buf).sort((a, b) => a.offset - b.offset);

// global chain pstr16 hits
const chainHits = [];
for (let p = 0; p < buf.length - 4; p++) {
  const r = readPstr16Asciiz(buf, p);
  if (!r) continue;
  if (CHAIN_SET.has(r.str)) { chainHits.push({ off: p, name: r.str, totalLen: r.totalLen }); p += r.totalLen - 1; }
}

function rosterBetween(lo, hi) {
  const out = new Set();
  for (const h of chainHits) {
    if (h.off < lo) continue;
    if (h.off >= hi) break;
    const lvls = CHAINS[h.name] || [];
    const lvlByte = buf[h.off + h.totalLen + 4];
    out.add(h.name + '=' + (lvls[lvlByte] !== undefined ? lvls[lvlByte] : ('?' + lvlByte)));
  }
  return out;
}
function jac(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

let fwd = 0, prev = 0, n = 0;
let fwdExact = 0, prevExact = 0; // count of perfect (jaccard==1) matches
const mismatchExamples = [];
for (let i = 0; i < markers.length; i++) {
  const city = markers[i].name;
  const region = city2region[city];
  if (!region) continue;
  const expected = region2sig[region];
  if (!expected || expected.size < 2) continue;
  const rFwd = rosterBetween(markers[i].blockEnd, i + 1 < markers.length ? markers[i + 1].offset : buf.length);
  const rPrev = i > 0 ? rosterBetween(markers[i - 1].blockEnd, markers[i].offset) : new Set();
  const jf = jac(expected, rFwd), jp = jac(expected, rPrev);
  fwd += jf; prev += jp; n++;
  if (jf === 1) fwdExact++;
  if (jp === 1) prevExact++;
}
console.log('SAVE: ' + (process.argv[2] || 'save_macedon t0.sav'));
console.log('Markers matched to a city/region with >=2 buildings: ' + n);
console.log('  FORWARD avg jaccard (exact chain=level): ' + (fwd / n).toFixed(3) + '   perfect matches: ' + fwdExact + '/' + n);
console.log('  PREV    avg jaccard (exact chain=level): ' + (prev / n).toFixed(3) + '   perfect matches: ' + prevExact + '/' + n);
console.log('  => winner: ' + (fwd > prev ? 'FORWARD' : 'PREV/INVERSE'));

// Now: using the winning model, show what the BLOCK BETWEEN markers actually is.
// The roster after marker[i].blockEnd up to marker[i+1].offset -- is it
// settlement i (FORWARD) or i+1 (INVERSE)? Print a few aligned triples.
console.log('\n=== Alignment audit (winning model) ===');
const useFwd = fwd >= prev;
let shown = 0;
for (let i = 1; i < markers.length - 1 && shown < 10; i++) {
  const city = markers[i].name;
  const region = city2region[city];
  if (!region) continue;
  const expected = region2sig[region];
  if (!expected || expected.size < 3) continue;
  const rFwd = rosterBetween(markers[i].blockEnd, markers[i + 1].offset);
  const rPrev = rosterBetween(markers[i - 1].blockEnd, markers[i].offset);
  const jf = jac(expected, rFwd), jp = jac(expected, rPrev);
  console.log('\n  marker[' + i + ']="' + city + '" region="' + region + '"  jacFWD=' + jf.toFixed(2) + ' jacPREV=' + jp.toFixed(2));
  console.log('    expected : ' + [...expected].sort().join(', '));
  console.log('    FWD      : ' + [...rFwd].sort().join(', '));
  console.log('    PREV     : ' + [...rPrev].sort().join(', '));
  shown++;
}
