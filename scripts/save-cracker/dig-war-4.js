// Find which "numidia" instances disappeared between peace and war.
// Those are the bytes encoding the Spain↔Carthage diplomatic state
// (with Numidia affected as Carthage's ally).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

function positions(buf, str) {
  const hits = [];
  let p = 0;
  const needle = Buffer.from(str);
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}
const numA = positions(peace, 'numidia');
const numB = positions(war, 'numidia');
console.log('numidia in peace (' + numA.length + ' instances):');
console.log('numidia in war   (' + numB.length + ' instances)');

// Fingerprint each position by 16 bytes around it (to handle position shifts)
function fp(buf, pos) {
  const slice = buf.subarray(pos - 8, pos + 24);
  return slice.toString('hex');
}

// Build a multimap of fingerprint → positions in peace
const peaceFps = new Map();
for (const p of numA) {
  const key = fp(peace, p);
  if (!peaceFps.has(key)) peaceFps.set(key, []);
  peaceFps.get(key).push(p);
}
const warFps = new Map();
for (const p of numB) {
  const key = fp(war, p);
  if (!warFps.has(key)) warFps.set(key, []);
  warFps.get(key).push(p);
}

console.log('\n=== Fingerprints in peace but NOT in war ===');
for (const [fpKey, positions] of peaceFps) {
  if (!warFps.has(fpKey)) {
    for (const p of positions) {
      console.log('\nPeace 0x' + p.toString(16) + ' (not in war):');
      const slice = peace.subarray(p - 32, p + 32);
      for (let o = 0; o < slice.length; o += 16) {
        const sub = slice.subarray(o, Math.min(o + 16, slice.length));
        const hex = Array.from(sub).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const asc = Array.from(sub).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
        console.log('  +' + (o - 32) + ': ' + hex.padEnd(48) + '  ' + asc);
      }
    }
  }
}
console.log('\n=== Fingerprints in war but NOT in peace ===');
for (const [fpKey, positions] of warFps) {
  if (!peaceFps.has(fpKey)) {
    for (const p of positions) {
      console.log('\nWar 0x' + p.toString(16) + ' (new context):');
      const slice = war.subarray(p - 32, p + 32);
      for (let o = 0; o < slice.length; o += 16) {
        const sub = slice.subarray(o, Math.min(o + 16, slice.length));
        const hex = Array.from(sub).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const asc = Array.from(sub).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
        console.log('  +' + (o - 32) + ': ' + hex.padEnd(48) + '  ' + asc);
      }
    }
  }
}

// Now also check carthage — even though count is same, the relation entry
// SHOULD have changed. Look for fingerprints that moved (same context,
// different position) vs new fingerprints.
console.log('\n=== Carthage fingerprints in peace but NOT in war ===');
const carthA = positions(peace, 'carthage');
const carthB = positions(war, 'carthage');
const carthAFps = new Map();
for (const p of carthA) { const k = fp(peace, p); if (!carthAFps.has(k)) carthAFps.set(k, []); carthAFps.get(k).push(p); }
const carthBFps = new Map();
for (const p of carthB) { const k = fp(war, p); if (!carthBFps.has(k)) carthBFps.set(k, []); carthBFps.get(k).push(p); }
let lostCarth = 0;
for (const [fpKey, positions] of carthAFps) {
  if (!carthBFps.has(fpKey)) {
    lostCarth++;
    for (const p of positions) {
      console.log('Peace 0x' + p.toString(16) + ' (Carthage context lost):');
      const slice = peace.subarray(p - 32, p + 32);
      for (let o = 0; o < slice.length; o += 16) {
        const sub = slice.subarray(o, Math.min(o + 16, slice.length));
        const hex = Array.from(sub).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const asc = Array.from(sub).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
        console.log('  +' + (o - 32) + ': ' + hex.padEnd(48) + '  ' + asc);
      }
    }
  }
}
console.log('Carthage contexts lost:', lostCarth);
