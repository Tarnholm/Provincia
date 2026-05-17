// STRICT building walker — use exact 78-byte stride, stop on first invalid.
// Compare T1 save Spain buildings against descr_strat.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

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

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const defSets = findPstr16Asciiz(T1, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(T1, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  settlements.push({ name: readPstr16Utf16(T1, nameOff).str, defSet: ds, nameOff });
}

// STRICT walker — building stride is exactly pstr16_total + 78
function walkBuildingsStrict(s) {
  let p = s.defSet + 14 + 61;
  const buildings = [];
  while (true) {
    const r = readPstr16Asciiz(T1, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str === 'default_set') break;  // hit next sub-section
    buildings.push({ name: r.str, tier: T1[p + r.totalLen + 4], culture: T1[p + r.totalLen + 76] });
    p += r.totalLen + 78;
  }
  return buildings;
}

console.log('=== T1 Save Spain settlements: strict walker vs descr_strat ===\n');

const SPAIN_VANILLA = {
  Asturica: {
    region: 'Gallaecia', level: 'large_town', pop: 2500,
    buildings: ['barracks/muster_field', 'core_building/governors_villa', 'defenses/wooden_pallisade'],
  },
  Scallabis: {
    region: 'Lusitania', level: 'large_town', pop: 2200,
    buildings: ['core_building/governors_villa', 'missiles/practice_field', 'defenses/wooden_pallisade'],
  },
  Carthago_Nova: {
    region: 'Hispania', level: 'town', pop: 2000,
    buildings: ['core_building/governors_house', 'defenses/wooden_pallisade', 'barracks/muster_field'],
  },
  Osca: {
    region: 'Taraconenis', level: 'town', pop: 1500,
    buildings: ['core_building/governors_house', 'barracks/muster_field'],
  },
};

for (const [name, expected] of Object.entries(SPAIN_VANILLA)) {
  const s = settlements.find(x => x.name === name);
  if (!s) { console.log(name + ': not found'); continue; }
  const buildings = walkBuildingsStrict(s);
  console.log('--- ' + name + ' (' + expected.region + ', ' + expected.level + ', pop ' + expected.pop + ') ---');
  console.log('  descr_strat says: ' + expected.buildings.join(', '));
  console.log('  T1 cracker found: ' + buildings.map(b => b.name + (b.tier ? '/t' + b.tier : '')).join(', '));
  // Check coverage
  const expectedCategories = expected.buildings.map(b => b.split('/')[0]);
  const foundCategories = buildings.map(b => b.name);
  const missing = expectedCategories.filter(c => !foundCategories.includes(c));
  const extra = foundCategories.filter(c => !expectedCategories.includes(c));
  if (missing.length === 0 && extra.length === 0) console.log('  ✓ EXACT MATCH');
  else {
    if (missing.length > 0) console.log('  ⚠ Missing: ' + missing.join(', '));
    if (extra.length > 0) console.log('  ⚠ Extra: ' + extra.join(', '));
  }
  console.log();
}
