// Enumerate distinct architectural-model names in the settlement-model block.
// Block range: 0x1f47809..0x1f8f9bc
// Try multiple encodings; fall back to ASCII run scanning.

const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const START = 0x1f47809;
const END = 0x1f8f9bc;
const buf = fs.readFileSync(path);
const slice = buf.slice(START, END);

console.log('block size: ' + slice.length);
console.log('first 96 bytes hex: ' + slice.slice(0, 96).toString('hex'));
console.log('first 96 bytes ascii: ' + slice.slice(0, 96).toString('ascii').replace(/[^\x20-\x7e]/g, '.'));

// Approach: scan for ASCII runs >= 8 chars terminated by NUL, then look at the
// 2 bytes preceding the run to confirm a length prefix.
const isAscii = (b) => b >= 0x20 && b <= 0x7e;
const seen = new Map();

let i = 0;
while (i < slice.length) {
  if (isAscii(slice[i])) {
    let j = i;
    while (j < slice.length && isAscii(slice[j])) j++;
    const runLen = j - i;
    if (runLen >= 6) {
      const s = slice.slice(i, j).toString('ascii');
      // store every ASCII run; we'll filter later
      seen.set(s, (seen.get(s) || 0) + 1);
    }
    i = j + 1;
  } else {
    i++;
  }
}

const namesRaw = [...seen.keys()];
console.log('\nraw ascii runs >=6 chars: ' + namesRaw.length);

// Filter: must look like a model identifier (CamelCase + underscores)
const namesFiltered = namesRaw.filter(s => /^[A-Za-z][A-Za-z0-9_]+$/.test(s) && s.length >= 6);
console.log('filtered identifier-like names: ' + namesFiltered.length);
namesFiltered.sort();
for (const n of namesFiltered) console.log('  count=' + seen.get(n).toString().padStart(4) + '  ' + n);

// Classify
const LEVELS = ['Huge_City','Large_City','Large_Town','City','Town','Village'];
const CULTURES = [
  ['Roman','roman'],
  ['Barbarian','barbarian'],
  ['Celtic','barbarian'],
  ['Germanic','barbarian'],
  ['Scythian','nomad'],
  ['Carthaginian','carthaginian'],
  ['Eastern','eastern'],
  ['Parthian','eastern'],
  ['Nomad','nomad'],
  ['Egyptian','egyptian'],
  ['Greek','greek'],
  ['Numidian','carthaginian'],
  ['Illyrian','barbarian'],     // RTW groups Illyrian under barbarian
  ['W_hellenistic','greek'],    // Western hellenistic = Greek/Roman classical
  ['hellenistic','greek'],
];
function classify(n) {
  // strip optional _Walls/_Wall suffix when classifying level
  const base = n.replace(/_(Walls?|wall|walls)$/, '');
  let lvl = null;
  for (const L of LEVELS) {
    const lc = L.toLowerCase();
    if (base.toLowerCase().endsWith(lc)) { lvl = L; break; }
  }
  let cul = null;
  for (const [needle, fam] of CULTURES) {
    if (base.includes(needle)) { cul = fam; break; }
  }
  return { culture: cul, level: lvl, hasWalls: /walls?$/i.test(n) };
}

console.log('\nclassification:');
const byCul = new Map();
for (const n of namesFiltered) {
  const { culture, level, hasWalls } = classify(n);
  console.log('  ' + n.padEnd(40) + ' culture=' + (culture||'?').padEnd(13) + ' level=' + (level||'?').padEnd(11) + ' walls=' + hasWalls);
  const key = (culture||'?') + ' / ' + (level||'?');
  byCul.set(key, (byCul.get(key) || 0) + 1);
}
console.log('\nculture x level matrix entries:');
for (const [k, v] of [...byCul.entries()].sort()) console.log('  ' + k + ' : ' + v);
