// Find vanilla Rome's JOURNAL/EVENT-LOG section. In RIS imperial it was at
// the late tail with `<u32 selfPtr><u32 ver=3><i32 year><...><pstr16 name>
// <pstr16 event_type><pstr16 message>` records.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

console.log('File sizes: peace=' + peace.length + ' war=' + war.length);
console.log('Δ:', war.length - peace.length, 'bytes\n');

// Vanilla Rome RIS-style journal scan: u32 selfPtr at pos, u32=3, i32 year
function findJournals(buf) {
  const hits = [];
  for (let p = 0x100000; p + 30 < buf.length; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 4) !== 3) continue;
    const year = buf.readInt32LE(p + 8);
    if (year < -3000 || year > 3000) continue;
    const strlen = buf.readUInt16LE(p + 20);
    if (strlen < 2 || strlen > 50) continue;
    // Verify UTF-16 ASCII string at +22
    let ok = true;
    const chars = [];
    for (let k = 0; k < strlen; k++) {
      const c = buf.readUInt16LE(p + 22 + k * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      chars.push(String.fromCharCode(c));
    }
    if (!ok) continue;
    hits.push({ pos: p, year, name: chars.join('') });
  }
  return hits;
}

console.log('=== Journal records in peace (RIS-style scan) ===');
const peaceJournals = findJournals(peace);
console.log('Peace journals:', peaceJournals.length);
console.log('War journals:', findJournals(war).length);

if (peaceJournals.length > 0) {
  console.log('\nFirst 20 peace journal records:');
  for (const j of peaceJournals.slice(0, 20)) {
    console.log('  0x' + j.pos.toString(16) + '  yr=' + j.year + '  name="' + j.name + '"');
  }
}

// Also search for any UTF-16 message string containing "war" or "peace" or
// "declares" to find diplomatic event messages
console.log('\n=== Search for diplomatic event messages ===');
function findUtf16(buf, str) {
  const needle = Buffer.from([...str].flatMap(c => [c.charCodeAt(0), 0]));
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; if (hits.length > 5) break; }
  return hits;
}
for (const s of ['declared war', 'declares war', 'siege', 'Siege', 'Carthage', 'has been adopted', 'has come of age', 'army has been', 'enemy', 'Enemy']) {
  const peaceHits = findUtf16(peace, s);
  const warHits = findUtf16(war, s);
  if (peaceHits.length > 0 || warHits.length > 0) {
    console.log('  "' + s + '" peace=' + peaceHits.length + ' war=' + warHits.length);
  }
}

// Find first/last diff between peace and war to bound where new content was added
let firstDiff = -1, lastDiffWar = -1;
for (let i = 0; i < Math.min(peace.length, war.length); i++) {
  if (peace[i] !== war[i]) { firstDiff = i; break; }
}
let ai = peace.length - 1, bi = war.length - 1;
while (ai >= 0 && bi >= 0) {
  if (peace[ai] !== war[bi]) { lastDiffWar = bi; break; }
  ai--; bi--;
}
console.log('\nDivergence range in war: 0x' + firstDiff.toString(16) + ' .. 0x' + lastDiffWar.toString(16));
console.log('File size delta:', war.length - peace.length, 'bytes');

// Look near the END of the divergence for any new content (e.g., war journal entry)
console.log('\n=== Last 200 bytes of divergence in war ===');
for (let o = Math.max(0, lastDiffWar - 200); o < lastDiffWar + 16; o += 16) {
  const slice = war.subarray(o, Math.min(o + 16, lastDiffWar + 16));
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
}
