// dig-naval-state.js
// Decode the type-4 fleet record's state field (N+8 u32, "f8").
// At t0 every fleet reads 0x17fff; at mid-turn saves f8 varies. Goal: figure
// out which bit(s) encode "moved this turn" / activity, by:
//   (a) byte-decomposing f8 across a moved-fleet save (Carthage T2 Start)
//   (b) testing the land-army convention: byte at N+9 bit 0x80 = moved-flag
//   (c) diffing the SAME fleet (by faction+near-coord) between a turn-end and
//       the next turn-start snapshot to correlate the bit with actual movement.
//
// Research only.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

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
      f8: buf.readUInt32LE(N + 8),
      byte9: buf[N + 9],   // 2nd byte of f8 — land armies' moved-flag byte
      byte8: buf[N + 8],
    });
  }
  return map;
}

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
  while (lo < hi) { const m = (lo + hi) >> 1; if (markers[m].at <= off) { ans = markers[m].faction; lo = m + 1; } else hi = m; }
  return ans;
}

function fleets(buf) {
  const t4 = parseType4(buf);
  const markers = buildFactionMarkers(buf);
  const naval = findUnitRecords(buf).filter(u => /^naval\b/i.test(u.name)).sort((a, b) => a.offset - b.offset);
  let last = null; const g = new Map();
  for (const u of naval) {
    if (u.fleetUuid && t4.has(u.fleetUuid)) last = u.fleetUuid;
    if (!last) continue;
    if (!g.has(last)) g.set(last, []);
    g.get(last).push(u);
  }
  const out = [];
  for (const [fid, ships] of g) {
    const pos = t4.get(fid);
    out.push({ fid, x: pos.x, y: pos.y, f8: pos.f8, byte8: pos.byte8, byte9: pos.byte9,
      faction: factionAtOffset(markers, ships[0].offset), ships: ships.length });
  }
  return out;
}

// (a)+(b) byte decomposition + moved-bit on a moved-fleet save
const movedSave = 'save_Autosave   Carthage   Turn 2 Start.sav';
{
  const buf = fs.readFileSync(path.join(BASE, movedSave));
  const fl = fleets(buf);
  console.log('=== ' + movedSave + ' — f8 byte decomposition ===');
  console.log('f8 distinct values and what byte9 bit7 (0x80) says:');
  const byVal = {};
  for (const f of fl) byVal[f.f8] = (byVal[f.f8] || 0) + 1;
  for (const [v, c] of Object.entries(byVal).sort((a, b) => a[0] - b[0])) {
    const u = parseInt(v, 10);
    const b0 = u & 0xff, b1 = (u >> 8) & 0xff, b2 = (u >> 16) & 0xff, b3 = (u >> 24) & 0xff;
    console.log('  f8=0x' + u.toString(16).padStart(6, '0') +
      ' (count ' + c + ')  bytes[b0=0x' + b0.toString(16).padStart(2, '0') +
      ' b1=0x' + b1.toString(16).padStart(2, '0') +
      ' b2=0x' + b2.toString(16).padStart(2, '0') +
      ' b3=0x' + b3.toString(16).padStart(2, '0') + ']' +
      '  byte9(b1)&0x80=' + ((b1 & 0x80) ? 1 : 0) +
      '  b0&0x80=' + ((b0 & 0x80) ? 1 : 0));
  }
  // also show a few sample fleets with faction
  console.log('\n  sample fleets:');
  for (const f of fl.slice(0, 18)) {
    console.log('   0x' + f.fid.toString(16).padStart(8, '0') + ' (' + f.x + ',' + f.y + ') ' +
      String(f.faction).padEnd(16) + ' f8=0x' + f.f8.toString(16) +
      ' b0=0x' + f.byte8.toString(16).padStart(2, '0') + ' b1=0x' + f.byte9.toString(16).padStart(2, '0'));
  }
}

// (c) diff consecutive snapshots: Carthage T1 End -> T2 Start. Match fleets by
// faction + nearest coord (uuid changes between snapshots in RTW). Report
// whether f8 differs and whether the position moved.
const pairA = 'save_Autosave   Carthage   Turn 1 End.sav';
const pairB = 'save_Autosave   Carthage   Turn 2 Start.sav';
try {
  const a = fleets(fs.readFileSync(path.join(BASE, pairA)));
  const b = fleets(fs.readFileSync(path.join(BASE, pairB)));
  console.log('\n=== position/f8 diff: ' + pairA + ' -> ' + pairB + ' ===');
  console.log('A fleets=' + a.length + '  B fleets=' + b.length);
  // index B by faction
  const bByFac = new Map();
  for (const f of b) { if (!bByFac.has(f.faction)) bByFac.set(f.faction, []); bByFac.get(f.faction).push(f); }
  let moved = 0, f8changed = 0, both = 0, checked = 0;
  for (const fa of a) {
    const cands = bByFac.get(fa.faction);
    if (!cands || !cands.length) continue;
    // nearest by coord
    let best = null, bestD = 1e9;
    for (const fb of cands) {
      const d = Math.abs(fb.x - fa.x) + Math.abs(fb.y - fa.y);
      if (d < bestD) { bestD = d; best = fb; }
    }
    if (!best) continue;
    checked++;
    const didMove = bestD > 0;
    const f8diff = best.f8 !== fa.f8;
    if (didMove) moved++;
    if (f8diff) f8changed++;
    if (didMove && f8diff) both++;
    if (checked <= 16) {
      console.log('  ' + String(fa.faction).padEnd(14) +
        ' A(' + fa.x + ',' + fa.y + ') f8=0x' + fa.f8.toString(16) +
        ' -> B(' + best.x + ',' + best.y + ') f8=0x' + best.f8.toString(16) +
        '  moved=' + (didMove ? bestD : 0) + '  f8changed=' + (f8diff ? 'Y' : 'n'));
    }
  }
  console.log('\n  checked=' + checked + '  moved=' + moved + '  f8changed=' + f8changed + '  both(moved&f8changed)=' + both);
} catch (e) { console.log('\n(pair diff skipped: ' + e.message + ')'); }
