// Find the vanilla Rome faction list / table. Likely in the header area
// or just before the diplomatic records start (around 0x10000-0x12000).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

const FACTIONS = ['romans_julii', 'romans_brutii', 'romans_scipii', 'romans_senate',
  'macedon', 'greek_cities', 'thrace', 'dacia', 'scythia', 'parthia', 'pontus',
  'armenia', 'seleucid', 'egypt', 'numidia', 'carthage', 'spain', 'gauls',
  'britons', 'germans', 'slave'];

console.log('=== ALL ASCII faction-name occurrences (low offsets first) ===');
for (const fac of FACTIONS) {
  const needle = Buffer.from(fac);
  const hits = [];
  let p = 0;
  while ((p = peace.indexOf(needle, p)) !== -1) {
    // Check it's a complete word
    const before = p > 0 ? peace[p - 1] : 0;
    const after = peace[p + fac.length];
    const isWord = (before < 0x41 || before > 0x7a || (before >= 0x5b && before <= 0x60)) &&
                   (after === 0 || after < 0x41 || after > 0x7a);
    if (isWord) hits.push(p);
    p++;
  }
  console.log('  ' + fac.padEnd(16) + '  hits=' + hits.length + '  first: 0x' + (hits[0] || 0).toString(16) + '  lowest 5: ' + hits.slice(0, 5).map(o => '0x' + o.toString(16)).join(', '));
}

// What's around the diplomatic relation records (0x11929)? Let me dump
// 200 bytes before and look for any ASCII strings
console.log('\n=== ASCII strings in 0x11000..0x12000 (around first relation record) ===');
function findStrings(buf, start, end) {
  const out = [];
  let cur = '';
  let curStart = -1;
  for (let i = start; i < end; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) {
      if (cur === '') curStart = i;
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= 4) out.push({ off: curStart, str: cur });
      cur = '';
    }
  }
  return out;
}
const strs = findStrings(peace, 0x10000, 0x20000);
for (const s of strs) {
  if (s.str.length > 4) {
    console.log('  0x' + s.off.toString(16) + ' "' + s.str + '"');
  }
}
