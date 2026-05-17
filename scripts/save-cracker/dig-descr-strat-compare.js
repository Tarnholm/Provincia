// Compare cracker output to descr_strat for validation.
// Specifically for Spain's settlements (validated 1:1 against descr_strat).

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

// Vanilla descr_strat starting populations for Spain
const VANILLA_SPAIN = {
  'Asturica':       { region: 'Gallaecia',   pop: 2500, level: 'large_town' },
  'Scallabis':      { region: 'Lusitania',   pop: 2200, level: 'large_town' },
  'Carthago_Nova':  { region: 'Hispania',    pop: 2000, level: 'town' },
  'Osca':           { region: 'Taraconenis', pop: 1500, level: 'town' },
};

console.log('=== Spain T1 save vs descr_strat starting state ===');
console.log('Settlement      | binary fac@+0 | binary pop | descr_strat pop | match?');
for (const [name, expected] of Object.entries(VANILLA_SPAIN)) {
  const s = settlements.find(x => x.name === name);
  if (!s) { console.log('  ' + name.padEnd(20) + ' NOT FOUND'); continue; }
  const statsStart = s.nameOff - 583;
  const fac = T1.readUInt32LE(statsStart);
  const pop = T1.readUInt32LE(statsStart + 548);
  const popMatch = Math.abs(pop - expected.pop) < 300 ? '✓' : '✗';
  console.log('  ' + name.padEnd(15) + ' fac=' + String(fac).padStart(3) +
    '       | pop=' + String(pop).padStart(5) +
    '   | descr=' + expected.pop +
    '         | ' + popMatch + ' (' + expected.region + ', ' + expected.level + ')');
}

// Validate ownership match
console.log('\n=== Ownership validation for known vanilla owners ===');
const OWNERSHIP_TESTS = [
  { name: 'Carthago_Nova', expected: 18, faction: 'spain' },
  { name: 'Asturica',      expected: 18, faction: 'spain' },
  { name: 'Scallabis',     expected: 18, faction: 'spain' },
  { name: 'Osca',          expected: 18, faction: 'spain' },
  { name: 'Rome',          expected: 3,  faction: 'romans_senate' },
  { name: 'Tarentum',      expected: 2,  faction: 'romans_brutii' },  // Brutii=2 per descr_strat
  { name: 'Croton',        expected: 2,  faction: 'romans_brutii' },
  { name: 'Messana',       expected: 4,  faction: 'romans_scipii' },  // Scipii=4 per index mapping
  { name: 'Caralis',       expected: 7,  faction: 'carthage' },
  { name: 'Palma',         expected: 7,  faction: 'carthage' },
  { name: 'Thapsus',       expected: 7,  faction: 'carthage' },
  { name: 'Lilybaeum',     expected: 7,  faction: 'carthage' },
  { name: 'Corduba',       expected: 7,  faction: 'carthage' },
  { name: 'Memphis',       expected: 5,  faction: 'egypt' },
  { name: 'Numantia',      expected: 10, faction: 'gauls?_or_rebels' },
];

for (const t of OWNERSHIP_TESTS) {
  const s = settlements.find(x => x.name === t.name);
  if (!s) { console.log('  ' + t.name.padEnd(20) + ' NOT FOUND'); continue; }
  const statsStart = s.nameOff - 583;
  const fac = T1.readUInt32LE(statsStart);
  const match = fac === t.expected ? '✓' : '?';
  console.log('  ' + t.name.padEnd(20) + ' got fac=' + String(fac).padStart(3) + ' expected=' + String(t.expected).padStart(3) + ' (' + t.faction + ') ' + match);
}
