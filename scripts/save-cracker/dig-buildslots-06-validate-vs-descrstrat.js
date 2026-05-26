// dig-buildslots-06-validate-vs-descrstrat.js
// Determine the CORRECT settlement<->building-list association by matching the
// decoded building roster against descr_strat ground truth (which lists each
// region's exact starting buildings + levels).
//
// We test BOTH association models:
//   FORWARD : chains after name marker N belong to settlement N
//   INVERSE : chains after name marker N belong to settlement N+1 (buildingParser model)
// and report which gives the better match to descr_strat.

const fs = require('fs');
const path = require('path');
const bp = require(path.join('C:', 'dev', 'Provincia', 'src', 'buildingParser.js'));

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';
const DSTRAT = 'C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt';
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

// descr_strat: region -> { level, buildings: Map(chain->levelName) }
function loadDescrStrat() {
  const txt = fs.readFileSync(DSTRAT, 'latin1'); const lines = txt.split(/\r?\n/);
  const setts = []; let cur = null;
  for (const raw of lines) {
    const l = raw.replace(/;.*$/, '');
    let m = l.match(/^\s*region\s+(\w+)/);
    if (m) { if (cur) setts.push(cur); cur = { region: m[1], level: null, b: new Map() }; continue; }
    m = l.match(/^\s*level\s+(\w+)/); if (m && cur) cur.level = m[1];
    m = l.match(/^\s*type\s+(\w+)\s+(\S+)/); if (m && cur) cur.b.set(m[1], m[2]);
  }
  if (cur) setts.push(cur);
  return setts;
}
const DS = loadDescrStrat();
// Build a signature set for matching: for each ds region, the set "chain=level"
const dsSigs = DS.map(d => ({ region: d.region, level: d.level,
  sig: new Set([...d.b.entries()].map(([c, l]) => c + '=' + l)) }));

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

function rosterFor(i) {
  // chains between markers[i].blockEnd and markers[i+1].offset
  const m = markers[i];
  const next = i + 1 < markers.length ? markers[i + 1].offset : buf.length;
  const local = chainHits.filter(h => h.off >= m.blockEnd && h.off < next);
  return local.map(h => {
    const lvls = CHAINS[h.name] || [];
    const lvlByte = buf[h.off + h.totalLen + 4];
    return h.name + '=' + (lvls[lvlByte] || ('?' + lvlByte));
  });
}

// For a given roster (set of chain=level), find the best matching ds region.
function bestMatch(roster) {
  const rs = new Set(roster);
  let best = null;
  for (const d of dsSigs) {
    let inter = 0;
    for (const x of rs) if (d.sig.has(x)) inter++;
    const union = rs.size + d.sig.size - inter;
    const jac = union ? inter / union : 0;
    if (!best || jac > best.jac) best = { region: d.region, jac, inter, dsSize: d.sig.size, rosterSize: rs.size };
  }
  return best;
}

// Test FORWARD model: roster(i) belongs to markers[i]
// Test INVERSE model: roster(i) belongs to markers[i+1] -> i.e. to score INVERSE,
//   for settlement-name marker i, use roster(i-1).
let fwdScore = 0, invScore = 0, n = 0;
const examples = [];
for (let i = 0; i < markers.length; i++) {
  const rFwd = rosterFor(i);
  if (rFwd.length < 2) continue;
  n++;
  const mFwd = bestMatch(rFwd);
  fwdScore += mFwd.jac;
  // inverse: this roster(i) -> attribute to markers[i+1]? scoring is roster-based,
  // identical jaccard. The DIRECTION question is "which NAME owns this roster".
  if (examples.length < 15) examples.push({ name: markers[i].name, roster: rFwd, match: mFwd });
}
console.log('Rosters scored: ' + n);
console.log('Avg best-jaccard (roster vs descr_strat region): ' + (fwdScore / n).toFixed(3));

console.log('\n=== Name-marker vs best-matching descr_strat region (first 15 rosters) ===');
console.log('(if NAME != matched REGION-settlement, association is off-by-one / inverse)');
for (const e of examples) {
  console.log('\n  name-marker="' + e.name + '"  -> best ds region="' + e.match.region +
    '"  jaccard=' + e.match.jac.toFixed(2) + ' (' + e.match.inter + '/' + e.match.rosterSize + ' roster, ' + e.match.dsSize + ' ds)');
  console.log('     roster: ' + e.roster.join(', '));
}
