// dig-naval-robust.js
// 1) Inspect the 4 descr_strat-unmatched fleets — confirm they are real.
// 2) Run the fleet model on diverse saves: RIS t0, a vanilla classic save,
//    and a later-turn autosave, to confirm robustness.
// 3) Decode the type-4 record's extra fields:
//      +8  u32  (state flag? 0x00017fff observed)
//      +12 u32  (0x003f8000 observed — looks like a float? 0.5? )
//      +28 u32  = secondaryUuid that ALSO appears in the ship-record name trailer

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
    map.set(uuid, { x, y, off: N, secUuid: buf.readUInt32LE(N + 28),
      f8: buf.readUInt32LE(N + 8), f12: buf.readUInt32LE(N + 12) });
  }
  return map;
}

function buildFleets(buf) {
  const t4 = parseType4(buf);
  const naval = findUnitRecords(buf).filter(u => /^naval\b/i.test(u.name)).sort((a, b) => a.offset - b.offset);
  let lastFleet = null; const groups = new Map();
  for (const u of naval) {
    if (u.fleetUuid && t4.has(u.fleetUuid)) lastFleet = u.fleetUuid;
    if (!lastFleet) continue;
    if (!groups.has(lastFleet)) groups.set(lastFleet, []);
    groups.get(lastFleet).push(u);
  }
  return { t4, naval, groups };
}

// (1) the 4 unmatched RIS fleets
{
  const buf = fs.readFileSync(path.join(BASE, 'save_macedon t0.sav'));
  const { t4, groups } = buildFleets(buf);
  const unmatched = ['463,394', '432,320', '417,319', '456,442'];
  console.log('=== 4 descr_strat-unmatched RIS fleets ===');
  for (const [fid, ships] of groups) {
    const pos = t4.get(fid);
    if (!unmatched.includes(pos.x + ',' + pos.y)) continue;
    const types = {}; for (const s of ships) types[s.name] = (types[s.name] || 0) + 1;
    console.log('  fleet 0x' + fid.toString(16) + ' (' + pos.x + ',' + pos.y + ') ships=' + ships.length +
      ' ' + JSON.stringify(types) + ' secUuid=0x' + pos.secUuid.toString(16) +
      ' f8=0x' + pos.f8.toString(16) + ' f12=0x' + pos.f12.toString(16) +
      ' firstShip@0x' + ships[0].offset.toString(16));
  }
  // confirm secUuid == ship name trailer hash for a few fleets
  console.log('\n=== secUuid (type4 +28) vs ship-record name-trailer u32 ===');
  let chk = 0;
  for (const [fid, ships] of groups) {
    if (chk++ >= 5) break;
    const pos = t4.get(fid);
    const s = ships[0];
    // ship name trailer: at s.offset, [u16 len][name+\0][u8 ?][u32 hashA][u32 hashB?]
    // From dump: "0e 00 naval biremes\0 05 17 cf 4a bc f6 0e a2" — after name+\0 there's
    // 1 byte then 8 bytes. The fleet secUuid f6 0e a2 0f appeared at some offset.
    const nameEnd = s.offset + 2 + ('naval biremes'.length + 1); // approx; biremes only
    const trailer = [];
    for (let d = 0; d <= 12; d++) trailer.push(buf.readUInt32LE(nameEnd + d));
    console.log('  fleet 0x' + fid.toString(16) + ' secUuid=0x' + pos.secUuid.toString(16) +
      '  ship-trailer u32 (offsets +0..+12 after name): ' + trailer.slice(0, 13).map(v => '0x' + v.toString(16)).join(' '));
  }
}

// (2) robustness on other saves
console.log('\n=== robustness across saves ===');
for (const fname of ['save_t0.sav', 'save_Autosave   Carthage   Turn 2 Start.sav',
  'save_Autosave   Dummies   Turn 8 Start.sav']) {
  let buf; try { buf = fs.readFileSync(path.join(BASE, fname)); } catch (e) { console.log('  (skip ' + fname + ')'); continue; }
  const { naval, groups } = buildFleets(buf);
  const sizes = [...groups.values()].map(g => g.length);
  const inFleet = sizes.reduce((a, b) => a + b, 0);
  console.log('  ' + fname.padEnd(45) + ' ships=' + naval.length + ' fleets=' + groups.size +
    ' inFleet=' + inFleet + ' sizes[' + Math.min(...sizes, 0) + '..' + Math.max(...sizes, 0) + ']');
}
