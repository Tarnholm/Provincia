// dig-buildslots-07-association-direction.js
// Definitively resolve whether the building roster found AFTER a settlement-name
// marker belongs to THAT settlement (FORWARD) or to a neighbouring one (INVERSE).
//
// Method: build region->city-name from descr_regions, region->buildings from
// descr_strat. For each name marker (a city name), look up the expected building
// roster (via the city's region) and compare against:
//   FORWARD  : roster between markers[i].blockEnd and markers[i+1].offset
//   PREV     : roster between markers[i-1].blockEnd and markers[i].offset
// Report which model matches the marker's own city better, file-wide.

const fs = require('fs');
const path = require('path');
const bp = require(path.join('C:', 'dev', 'Provincia', 'src', 'buildingParser.js'));

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';
const DSTRAT = 'C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt';
const DREGIONS = 'C:\\RIS\\RIS\\data\\world\\maps\\base\\descr_regions.txt';
const buf = fs.readFileSync(path.join(SAVE_BASE, 'save_macedon t0.sav'));

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

// region -> city name (descr_regions: RegionName / Settlement / faction ...)
function loadRegions() {
  const txt = fs.readFileSync(DREGIONS, 'latin1'); const lines = txt.split(/\r?\n/);
  const region2city = {}; const city2region = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/;.*$/, '').trim();
    // A region header is a bare CapitalizedToken at column 0 followed by an
    // indented settlement name on the next non-comment line.
    if (/^[A-Z][A-Za-z0-9_'-]+$/.test(lines[i].replace(/;.*$/, '')) && !lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
      const region = l;
      // next non-empty line = city
      let j = i + 1;
      while (j < lines.length && lines[j].replace(/;.*$/, '').trim() === '') j++;
      const city = lines[j] ? lines[j].replace(/;.*$/, '').trim() : null;
      if (city && /^[A-Za-z]/.test(city)) { region2city[region] = city; city2region[city] = region; }
    }
  }
  return { region2city, city2region };
}
const { city2region } = loadRegions();

// region -> Set("chain=level")
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
const chainHits = [];
for (let p = 0; p < buf.length - 4; p++) {
  const r = readPstr16Asciiz(buf, p);
  if (!r) continue;
  if (CHAIN_SET.has(r.str)) { chainHits.push({ off: p, name: r.str, totalLen: r.totalLen }); p += r.totalLen - 1; }
}
// Pre-index chainHits by offset for range queries
function rosterBetween(lo, hi) {
  const out = [];
  for (const h of chainHits) {
    if (h.off < lo) continue;
    if (h.off >= hi) break;
    const lvls = CHAINS[h.name] || [];
    out.push(h.name + '=' + (lvls[buf[h.off + h.totalLen + 4]] || '?'));
  }
  return new Set(out);
}

function jac(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

let fwdSum = 0, prevSum = 0, n = 0;
const ex = [];
for (let i = 0; i < markers.length; i++) {
  const city = markers[i].name;
  const region = city2region[city];
  if (!region) continue;
  const expected = region2sig[region];
  if (!expected || expected.size < 2) continue;
  const fwd = rosterBetween(markers[i].blockEnd, i + 1 < markers.length ? markers[i + 1].offset : buf.length);
  const prev = i > 0 ? rosterBetween(markers[i - 1].blockEnd, markers[i].offset) : new Set();
  const jf = jac(expected, fwd), jp = jac(expected, prev);
  fwdSum += jf; prevSum += jp; n++;
  if (ex.length < 12) ex.push({ city, region, jf, jp, fwd: [...fwd], expected: [...expected] });
}
console.log('Markers matched to a known city/region: ' + n);
console.log('Avg jaccard FORWARD (roster AFTER marker):  ' + (fwdSum / n).toFixed(3));
console.log('Avg jaccard PREV    (roster BEFORE marker): ' + (prevSum / n).toFixed(3));
console.log('\n=> ' + (fwdSum > prevSum ? 'FORWARD model wins (roster after a name marker = THAT settlement)'
                                        : 'PREV/INVERSE model wins (roster after marker N belongs to marker N+1)'));

console.log('\n=== Examples ===');
for (const e of ex) {
  console.log('\n  city="' + e.city + '" region="' + e.region + '"  jacFWD=' + e.jf.toFixed(2) + ' jacPREV=' + e.jp.toFixed(2));
  console.log('     expected: ' + e.expected.sort().join(', '));
  console.log('     fwdRoster:' + e.fwd.sort().join(', '));
}
