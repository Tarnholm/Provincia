// dig-naval-final.js
// FINAL naval crack: validate the full fleet/ship model end-to-end using ONLY
// save-file data (no descr_strat dependency for the runtime path), then
// cross-check against descr_strat (armies_large.json) as ground truth.
//
// Produces:
//   1. Full per-fleet table: fleetUuid, (x,y), ships, composition, crew,
//      faction (attributed from save via captain_card marker), state flags.
//   2. Faction attribution accuracy: save-marker faction vs descr_strat-coord faction.
//   3. Classification of the 4 descr_strat-unmatched fleets (rebel/slave?).
//   4. State-flag survey (N+8 / N+12) — look for blockade / at-sea variation.
//   5. NAVAL POWER per faction computed from the SAVE ALONE.
//
// Research only; no app code modified.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = [
  'save_macedon t0.sav',
  'save_Seleucids t0.sav',
  'save_Autosave   Carthage   Turn 2 Start.sav',
  'save_Autosave   Dummies   Turn 8 Start.sav',
];

let armies = null;
try { armies = require('C:/dev/Provincia/public/armies_large.json'); } catch (e) {}

// descr_strat naval admirals keyed by "x,y" (ground truth)
const dsByCoord = new Map();
if (armies) {
  for (const v of Object.values(armies)) {
    const units = Array.isArray(v.units) ? v.units : [];
    const navs = units.filter(u => /naval/i.test(u.name || ''));
    if (!navs.length) continue;
    dsByCoord.set(v.x + ',' + v.y, { faction: v.faction, ships: navs.map(u => u.name) });
  }
}

// type-4 world-object (fleet) position records: N-12=4,N-8=uuid,N-4=N-4,N=x,N+4=y
function parseType4(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 32; N++) {
    if (buf.readUInt32LE(N - 12) !== 4) continue;
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const x = buf.readUInt32LE(N), y = buf.readUInt32LE(N + 4);
    if (x < 0 || x > 1100 || y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0 || uuid === 0xffffffff) continue;
    map.set(uuid, {
      x, y, off: N,
      f8: buf.readUInt32LE(N + 8),     // state flags (0x17fff baseline)
      f12: buf.readUInt32LE(N + 12),   // const 0x3f8000 baseline
    });
  }
  return map;
}

// captain_card faction markers → faction-at-offset (binary search), mirrors main.js
function buildFactionMarkers(buf) {
  const out = [];
  const pattern = Buffer.from('captain_card_', 'ascii');
  let p = 0;
  while ((p = buf.indexOf(pattern, p)) !== -1) {
    let end = p + pattern.length;
    while (end < p + 80 && buf[end] !== 0x2e && buf[end] >= 0x20 && buf[end] < 0x7f) end++;
    out.push({ at: p, faction: buf.slice(p + pattern.length, end).toString('ascii') });
    p = end;
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}
function factionAtOffset(markers, off) {
  let lo = 0, hi = markers.length, ans = null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid].at <= off) { ans = markers[mid].faction; lo = mid + 1; }
    else hi = mid;
  }
  return ans;
}

for (const fname of SAVES) {
  let buf;
  try { buf = fs.readFileSync(path.join(BASE, fname)); }
  catch (e) { console.log('\n(skip ' + fname + ')'); continue; }
  console.log('\n======================================================================');
  console.log(fname + '  (' + (buf.length / 1e6).toFixed(1) + ' MB)');
  console.log('======================================================================');

  const t4 = parseType4(buf);
  const markers = buildFactionMarkers(buf);
  const naval = findUnitRecords(buf).filter(u => /^naval\b/i.test(u.name)).sort((a, b) => a.offset - b.offset);

  // group into fleets (file-order inheritance against the t4 map)
  let lastFleet = null;
  const groups = new Map();
  for (const u of naval) {
    if (u.fleetUuid && t4.has(u.fleetUuid)) lastFleet = u.fleetUuid;
    if (!lastFleet) continue;
    if (!groups.has(lastFleet)) groups.set(lastFleet, []);
    groups.get(lastFleet).push(u);
  }

  // --- per-fleet table + faction attribution checks ---
  let coordMatched = 0, factionAgree = 0, factionChecked = 0;
  const f8hist = {}, f12hist = {};
  const navalPowerSave = {};   // faction (from save marker) -> {fleets,ships}
  const unmatched = [];
  console.log('\nfleet       pos        ships comp        crew  saveFaction        dsFaction       f8        match');
  for (const [fid, ships] of groups) {
    const pos = t4.get(fid);
    f8hist[pos.f8] = (f8hist[pos.f8] || 0) + 1;
    f12hist[pos.f12] = (f12hist[pos.f12] || 0) + 1;
    const saveFac = factionAtOffset(markers, ships[0].offset);
    const ds = dsByCoord.get(pos.x + ',' + pos.y);
    const crew = ships.reduce((a, s) => a + (s.soldiers || 0), 0);
    const comp = (() => {
      const t = {};
      for (const s of ships) t[s.name.replace('naval ', '')] = (t[s.name.replace('naval ', '')] || 0) + 1;
      return Object.entries(t).map(([n, c]) => c + 'x' + n).join(',');
    })();
    if (ds) {
      coordMatched++;
      factionChecked++;
      const agree = saveFac === ds.faction;
      if (agree) factionAgree++;
    } else {
      unmatched.push({ fid, pos, saveFac, ships });
    }
    // naval power keyed on SAVE faction
    const fkey = saveFac || 'unknown';
    if (!navalPowerSave[fkey]) navalPowerSave[fkey] = { fleets: 0, ships: 0 };
    navalPowerSave[fkey].fleets++;
    navalPowerSave[fkey].ships += ships.length;

    // only print first 12 to keep output readable
    if (coordMatched + unmatched.length <= 12) {
      console.log(
        '0x' + fid.toString(16).padStart(8, '0') + ' (' +
        String(pos.x).padStart(3) + ',' + String(pos.y).padStart(3) + ') ' +
        String(ships.length).padStart(2) + '  ' + comp.padEnd(11) + ' ' +
        String(crew).padStart(4) + '  ' + String(saveFac).padEnd(18) + ' ' +
        String(ds ? ds.faction : '-').padEnd(15) + ' 0x' +
        pos.f8.toString(16).padStart(5, '0') + '  ' +
        (ds ? (saveFac === ds.faction ? 'OK' : 'DIFF') : 'no-ds'));
    }
  }

  console.log('\nfleets=' + groups.size +
    ' | coord-matched=' + coordMatched +
    ' | faction-attribution agree=' + factionAgree + '/' + factionChecked +
    ' (save-marker vs descr_strat coord)');
  console.log('state-flag f8 histogram:  ' + JSON.stringify(f8hist));
  console.log('state-flag f12 histogram: ' + JSON.stringify(f12hist));

  // --- classify the descr_strat-unmatched fleets ---
  if (unmatched.length) {
    console.log('\ndescr_strat-UNMATCHED fleets (' + unmatched.length + '):');
    for (const u of unmatched) {
      console.log('  0x' + u.fid.toString(16) + ' (' + u.pos.x + ',' + u.pos.y + ')' +
        ' ships=' + u.ships.length + ' saveFaction=' + u.saveFac +
        ' firstShip@0x' + u.ships[0].offset.toString(16));
    }
  }

  // --- NAVAL POWER per faction from the SAVE alone ---
  console.log('\nNAVAL POWER per faction (SAVE-ONLY, via captain_card marker):');
  for (const [fac, p] of Object.entries(navalPowerSave).sort((a, b) => b[1].ships - a[1].ships)) {
    console.log('   ' + fac.padEnd(20) + ' fleets=' + String(p.fleets).padStart(2) + '  ships=' + p.ships);
  }
}
