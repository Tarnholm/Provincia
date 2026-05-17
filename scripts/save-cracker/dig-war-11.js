// CRACK: decode the diplomatic relation records at 0x11929 and 0x17bfd.
// Both flipped from 200 (DS_NEUTRAL) to 600 (DS_AT_WAR) between peace
// and war. Find the surrounding faction tags / record structure.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

function dump(buf, off, len, label) {
  console.log('--- ' + label + ' ---');
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}

// Decode record at 0x11929 — the attitude byte is at i32@0x11929. The
// record likely has structure like (factionA, factionB, attitude, ...).
console.log('=== Record around 0x11929 (peace) ===');
dump(peace, 0x11929 - 64, 128, 'peace 0x11929');
console.log('\n=== Same area in war ===');
dump(war, 0x11929 - 64, 128, 'war 0x11929');

console.log('\n=== Record around 0x17bfd (peace) ===');
dump(peace, 0x17bfd - 64, 128, 'peace 0x17bfd');
console.log('\n=== Same area in war ===');
dump(war, 0x17bfd - 64, 128, 'war 0x17bfd');

// Try to identify the record structure: is there a u32 just before the
// attitude byte that's a faction tag? Are there two faction tags (the
// pair encoding)?
console.log('\n=== Field-by-field decode of 0x11929 area ===');
for (let off = -32; off < 32; off += 4) {
  const p = 0x11929 + off;
  if (p < 0 || p + 4 > peace.length) continue;
  const pV = peace.readInt32LE(p);
  const wV = war.readInt32LE(p);
  const mark = pV !== wV ? '  <-- CHANGED' : '';
  console.log('  i32@+' + off.toString().padStart(3) + ' (file 0x' + p.toString(16) + '): peace=' + pV + ' war=' + wV + mark);
}

console.log('\n=== Field-by-field decode of 0x17bfd area ===');
for (let off = -32; off < 32; off += 4) {
  const p = 0x17bfd + off;
  if (p < 0 || p + 4 > peace.length) continue;
  const pV = peace.readInt32LE(p);
  const wV = war.readInt32LE(p);
  const mark = pV !== wV ? '  <-- CHANGED' : '';
  console.log('  i32@+' + off.toString().padStart(3) + ' (file 0x' + p.toString(16) + '): peace=' + pV + ' war=' + wV + mark);
}

// Look for "spain" or "carthage" near these positions
function near(buf, pos, str) {
  const start = Math.max(0, pos - 200);
  const end = Math.min(buf.length, pos + 200);
  const sliceBuf = buf.subarray(start, end);
  const needle = Buffer.from(str);
  const idx = sliceBuf.indexOf(needle);
  if (idx === -1) return null;
  return start + idx;
}
console.log('\n=== Faction strings near these positions ===');
for (const [name, pos] of [['0x11929', 0x11929], ['0x17bfd', 0x17bfd]]) {
  for (const fac of ['spain', 'carthage', 'numidia', 'gauls', 'macedon', 'egypt', 'parthia', 'germans']) {
    const n = near(peace, pos, fac);
    if (n !== null) console.log('  near ' + name + ': "' + fac + '" at 0x' + n.toString(16) + ' (delta=' + (n - pos) + ')');
  }
}

// Also check for ALL i32 values that equal 600 in war save (in case there
// are more diplomatic-state records I missed)
console.log('\n=== All i32 == 600 positions in WAR save ===');
const at600Positions = [];
for (let i = 0; i + 4 <= war.length; i++) {
  if (war.readInt32LE(i) === 600) {
    at600Positions.push(i);
  }
}
console.log('Total i32 == 600 in war:', at600Positions.length);
// Also count in peace for comparison
const peace600 = [];
for (let i = 0; i + 4 <= peace.length; i++) {
  if (peace.readInt32LE(i) === 600) {
    peace600.push(i);
  }
}
console.log('Total i32 == 600 in peace:', peace600.length);
console.log('Net new "600" values in war: ' + (at600Positions.length - peace600.length));
