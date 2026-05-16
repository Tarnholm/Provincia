// Cross-validate war declaration: find bytes that change identically in
// BOTH war-declared saves (attack and besiege) vs the peace baseline.
// Those are pure war-declaration bytes, not battle/siege-specific.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace  = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war_attack = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav'));
const war_siege  = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged .sav'));

console.log('peace:        ', peace.length);
console.log('war_attack:   ', war_attack.length, '(Δ=' + (war_attack.length - peace.length) + ')');
console.log('war_siege:    ', war_siege.length, '(Δ=' + (war_siege.length - peace.length) + ')');

// Year/counter check
console.log('\nYear@0x514: peace=' + peace.readInt32LE(0x514) + ' attack=' + war_attack.readInt32LE(0x514) + ' siege=' + war_siege.readInt32LE(0x514));

// Carthage / Spain ASCII counts
function count(buf, str) {
  let n = 0, p = 0;
  const needle = Buffer.from(str);
  while ((p = buf.indexOf(needle, p)) !== -1) { n++; p++; }
  return n;
}
console.log('\nFaction ASCII counts:');
for (const f of ['carthage', 'spain', 'romans_julii', 'numidia', 'gauls', 'slave', 'rebels']) {
  console.log('  ' + f.padEnd(14) + ' peace=' + count(peace, f) + '  attack=' + count(war_attack, f) + '  siege=' + count(war_siege, f));
}

// Find the "carthage" ASCII positions in each save and compare
function positions(buf, str) {
  const hits = [];
  let p = 0;
  const needle = Buffer.from(str);
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}
const carthPeace  = positions(peace, 'carthage');
const carthAttack = positions(war_attack, 'carthage');
const carthSiege  = positions(war_siege, 'carthage');
console.log('\nCarthage ASCII positions:');
console.log('  peace ( ' + carthPeace.length + '):  ', carthPeace.map(o => '0x' + o.toString(16)).join(', '));
console.log('  attack(' + carthAttack.length + '):  ', carthAttack.map(o => '0x' + o.toString(16)).join(', '));
console.log('  siege ( ' + carthSiege.length + '):  ', carthSiege.map(o => '0x' + o.toString(16)).join(', '));

// For each carthage position in peace, dump 16 bytes of context. Then for the
// nearest position in the war saves, see if the context is the SAME
// (which means it's still there) or DIFFERENT (modified)
console.log('\n=== Peace carthage positions, context (16 bytes) ===');
for (const pos of carthPeace) {
  const slice = peace.subarray(pos - 16, pos + 24);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  peace 0x' + pos.toString(16) + ': ' + hex + '  ' + asc);
}

// Same for war saves
console.log('\n=== War-attack carthage contexts ===');
for (const pos of carthAttack) {
  const slice = war_attack.subarray(pos - 16, pos + 24);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  attack 0x' + pos.toString(16) + ': ' + hex + '  ' + asc);
}

console.log('\n=== War-siege carthage contexts ===');
for (const pos of carthSiege) {
  const slice = war_siege.subarray(pos - 16, pos + 24);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  siege 0x' + pos.toString(16) + ': ' + hex + '  ' + asc);
}

// Identify the 2 carthage positions that are PRESENT in peace but NOT in attack/siege.
// Since positions may shift, compare by 16-byte context fingerprint.
function fingerprint(buf, pos) {
  return buf.subarray(pos - 8, pos + 16).toString('hex');
}
const peaceFps = new Map();
for (const p of carthPeace) peaceFps.set(fingerprint(peace, p), p);
const attackFps = new Set(carthAttack.map(p => fingerprint(war_attack, p)));
const siegeFps = new Set(carthSiege.map(p => fingerprint(war_siege, p)));

console.log('\n=== Carthage instances LOST in war (present in peace, missing in BOTH war saves) ===');
for (const [fp, peacePos] of peaceFps) {
  if (!attackFps.has(fp) && !siegeFps.has(fp)) {
    console.log('  Lost at peace 0x' + peacePos.toString(16) + '  fingerprint=' + fp);
    // Print full 64-byte context
    const slice = peace.subarray(peacePos - 32, peacePos + 32);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    for (let oo = 0; oo < 64; oo += 16) {
      const sub = slice.subarray(oo, Math.min(oo + 16, 64));
      const h = Array.from(sub).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const a = Array.from(sub).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
      console.log('    +' + (oo - 32) + ': ' + h.padEnd(48) + '  ' + a);
    }
  }
}
