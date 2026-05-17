// Find a CLEAN faction-name list in the save (without "_men" or "_rebel"
// suffixes). Each name should be exactly the faction identifier as in
// descr_strat.txt.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

const FACTIONS = ['romans_julii', 'romans_brutii', 'romans_scipii', 'romans_senate',
  'macedon', 'greek_cities', 'thrace', 'dacia', 'scythia', 'parthia', 'pontus',
  'armenia', 'seleucid', 'egypt', 'numidia', 'carthage', 'spain', 'gauls',
  'britons', 'germans', 'slave'];

// Find each faction as ASCIIZ pstr (with length prefix and null terminator)
console.log('=== Search for length-prefixed ASCIIZ pstr16 faction names ===');
function findAsciizPstr16(buf, str) {
  const target = Buffer.from(str + '\0');
  const hits = [];
  for (let p = 0; p < buf.length - target.length - 2; p++) {
    // Read u16 strlen
    const lenP1 = buf.readUInt16LE(p);
    if (lenP1 !== target.length) continue;
    // Check the next bytes match the target
    if (buf.subarray(p + 2, p + 2 + target.length).equals(target)) {
      hits.push(p);
    }
  }
  return hits;
}

for (const fac of FACTIONS) {
  const hits = findAsciizPstr16(peace, fac);
  if (hits.length > 0) {
    console.log('  pstr16 ASCIIZ "' + fac + '": ' + hits.length + ' hits at ' + hits.slice(0, 5).map(o => '0x' + o.toString(16)).join(', '));
  }
}

// Also search for just the ASCIIZ form (null-terminated, no length prefix)
console.log('\n=== ASCIIZ-only (null-terminated, no length prefix) ===');
for (const fac of FACTIONS) {
  const target = Buffer.from(fac + '\0');
  const hits = [];
  let p = 0;
  while ((p = peace.indexOf(target, p)) !== -1) {
    // Check the byte BEFORE is not alphanumeric (to ensure it's a clean start)
    const before = p > 0 ? peace[p - 1] : 0;
    if (before === 0 || (before < 0x30 && before > 0)) {
      hits.push(p);
    }
    p++;
  }
  if (hits.length > 0) {
    console.log('  ASCIIZ "' + fac + '": ' + hits.length + ' hits at ' + hits.slice(0, 5).map(o => '0x' + o.toString(16)).join(', '));
  }
}
