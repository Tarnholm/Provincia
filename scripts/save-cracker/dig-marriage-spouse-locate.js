// Compare the NEW son-in-law record vs an EXISTING long-time general record.
// What field structure differs?

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// New son-in-law: at 0x153cc99 (role "general") per previous run
const NEW_HUSBAND = 0x153cc99;

// Find an EXISTING general by listing all "roman general" role strings
const target = Buffer.from('roman general\0', 'ascii');
const existingGenerals = [];
let p = 0;
while (true) {
  const i = T4.indexOf(target, p);
  if (i === -1) break;
  p = i + 1;
  if (i !== NEW_HUSBAND) existingGenerals.push(i);
}
console.log('Existing generals (excluding new husband): ' + existingGenerals.length);

// Search the file for the UUID 7d 2c 2d ef (= 0xef2d2c7d) — possible spouse UUID
const spouseUuid = Buffer.from([0x7d, 0x2c, 0x2d, 0xef]);
let p2 = 0;
const spouseUuidHits = [];
while (true) {
  const i = T4.indexOf(spouseUuid, p2);
  if (i === -1) break;
  spouseUuidHits.push(i);
  p2 = i + 1;
}
console.log('\nUUID 0x7d 0x2c 0x2d 0xef occurrences: ' + spouseUuidHits.length);
for (const h of spouseUuidHits.slice(0, 10)) console.log('  0x' + h.toString(16));

// For each occurrence, show short context
for (const h of spouseUuidHits.slice(0, 5)) {
  console.log('\n  @ 0x' + h.toString(16) + ':');
  for (let j = -16; j < 32; j += 16) {
    const hex = Array.from(T4.slice(h + j, h + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T4.slice(h + j, h + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = (j === 0) ? '  ← UUID' : '';
    console.log('    ' + (j >= 0 ? '+' : '') + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|' + mark);
  }
}

// Compare the NEW husband's record bytes (+0..+200) with an EXISTING general (first one)
console.log('\n\n=== Side-by-side: NEW husband vs EXISTING general (bytes after role string) ===');
const existing = existingGenerals[0];
console.log('NEW husband role @ 0x' + NEW_HUSBAND.toString(16));
console.log('EXISTING general role @ 0x' + existing.toString(16));
console.log();
console.log('offset | NEW husband              | EXISTING general          | diff');
for (let j = 0; j < 200; j += 8) {
  const newBytes = Array.from(T4.slice(NEW_HUSBAND + j, NEW_HUSBAND + j + 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const exBytes = Array.from(T4.slice(existing + j, existing + j + 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const same = newBytes === exBytes;
  console.log('+' + j.toString().padStart(3) + ' | ' + newBytes + ' | ' + exBytes + ' | ' + (same ? 'same' : 'DIFF'));
}
