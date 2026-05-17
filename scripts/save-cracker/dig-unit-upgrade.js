// Find unit upgrade bytes via Epidamnus retraining experiment
// T11 = just captured Epidamnus
// T12 = retrained + upgraded units there
// Diff should reveal weapon/armor upgrade level fields

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T11 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

console.log('T11 (enslave): ' + T11.length);
console.log('T12 (retrain): ' + T12.length);
console.log('Delta:         ' + (T12.length - T11.length));

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

// Find Epidamnus in both saves
const epi11 = findUtf16(T11, 'Epidamnus');
const epi12 = findUtf16(T12, 'Epidamnus');
console.log('\nEpidamnus T11: 0x' + epi11.toString(16));
console.log('Epidamnus T12: 0x' + epi12.toString(16));

// Get Epidamnus's building list from each save
function getBuildings(buf, nameOff) {
  const dsTarget = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
  const ds = buf.indexOf(dsTarget, nameOff);
  if (ds === -1 || ds - nameOff > 50) return null;
  let p = ds + 14 + 61;
  const buildings = [];
  while (true) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str === 'default_set') break;
    const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
    buildings.push({ name: r.str, tier: data[4] });
    p += r.totalLen + 78;
  }
  return buildings;
}

console.log('\n=== Epidamnus buildings in T11 vs T12 ===');
const b11 = getBuildings(T11, epi11);
const b12 = getBuildings(T12, epi12);
console.log('T11 (' + (b11?.length || 0) + ' buildings): ' + (b11 ? b11.map(b => b.name + '/t' + b.tier).join(', ') : 'NA'));
console.log('T12 (' + (b12?.length || 0) + ' buildings): ' + (b12 ? b12.map(b => b.name + '/t' + b.tier).join(', ') : 'NA'));

// Look at military buildings — what would retraining grant?
// Per EDB:
//   barracks/muster_field (t0): basic recruits
//   barracks/militia_barracks (t1): experience+1
//   smith/blacksmith (t0): weapon+1
//   smith/smiths_workshop (t1): weapon+2
//   foundry (t2): weapon+3
// So if Epidamnus has barracks t1 and smith t0 → retrained units get exp+1, weapon+1

console.log('\n=== File size delta analysis ===');
console.log('Δ = ' + (T12.length - T11.length) + ' bytes (smaller = some unit records changed)');

// Compare unit zones — what units changed
function zoneOf(off) {
  if (off < 0x37000) return 'pre-units';
  return 'units';
}

function diffRuns(a, b) {
  const len = Math.min(a.length, b.length);
  const runs = [];
  let runStart = -1;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        runs.push({ start: runStart, end: i - 1, len: i - runStart });
        runStart = -1;
      }
    }
  }
  if (runStart !== -1) runs.push({ start: runStart, end: len - 1, len: len - runStart });
  return runs;
}

// Look specifically for unit records around Epidamnus's tile (20, 50)
// Find character/unit records with "Epidamnus" pstr16 location AFTER retraining
console.log('\n=== Units stationed in Epidamnus (T12 vs T11) ===');

function findUnitsInLocation(buf, locationName) {
  // Find all pstr16 UTF-16 occurrences of location
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(locationName.length, 0);
  const strBytes = Buffer.alloc(locationName.length * 2);
  for (let i = 0; i < locationName.length; i++) strBytes.writeUInt16LE(locationName.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const t11Locs = findUnitsInLocation(T11, 'Epidamnus');
const t12Locs = findUnitsInLocation(T12, 'Epidamnus');
console.log('T11 Epidamnus locations: ' + t11Locs.length + ' (settlement + each unit stationed there)');
console.log('T12 Epidamnus locations: ' + t12Locs.length);

// Look at the bytes around each Epidamnus occurrence — units at this location have stats nearby
console.log('\n=== T11 Epidamnus unit records (find unit type just before each Epidamnus pstr16) ===');
function getUnitTypeBefore(buf, loc) {
  // Walk backward from loc to find an ASCII string (unit type name)
  for (let p = loc - 100; p < loc; p++) {
    if (p < 0 || buf[p] < 0x20 || buf[p] > 0x7e) continue;
    // Find ASCII run
    let q = p;
    while (q < loc && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
    if (q - p >= 6 && q - p <= 40) {
      const s = buf.slice(p, q).toString('latin1');
      if (s.includes(' ') && s[0] === s[0].toLowerCase()) {
        return { type: s, off: p, end: q };
      }
    }
    p = q;
  }
  return null;
}

const t11Units = [];
for (const loc of t11Locs.slice(0, 20)) {
  const u = getUnitTypeBefore(T11, loc);
  if (u) t11Units.push({ loc, ...u });
}
const t12Units = [];
for (const loc of t12Locs.slice(0, 20)) {
  const u = getUnitTypeBefore(T12, loc);
  if (u) t12Units.push({ loc, ...u });
}
console.log('T11 units in Epidamnus area:');
for (const u of t11Units) console.log('  "' + u.type + '" at 0x' + u.off.toString(16) + ' (loc 0x' + u.loc.toString(16) + ')');
console.log('\nT12 units in Epidamnus area:');
for (const u of t12Units) console.log('  "' + u.type + '" at 0x' + u.off.toString(16) + ' (loc 0x' + u.loc.toString(16) + ')');
