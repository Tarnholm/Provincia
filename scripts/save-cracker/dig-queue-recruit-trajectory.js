// dig-queue-recruit-trajectory.js
// Track the SAME recruit entry (aor etruscan spearmen, uuid 0x89213de4)
// across Arretium turns 2,3,4 to see which trailer fields change per turn
// (turns-elapsed / gold-paid-in) vs constant (cost / count / turns-total).

'use strict';
const fs = require('fs');
const path = require('path');

const ROME = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Rome', 'saves'
);

const saves = [
  { label: 'T2 queued', file: 'save_arretium turn 2 new unit queued.sav' },
  { label: 'T3',        file: 'save_arretium turn 3.sav' },
  { label: 'T4',        file: 'save_arretium turn 4.sav' },
];

const nameBuf = Buffer.from('aor etruscan spearmen\0', 'latin1');

const rows = [];
for (const s of saves) {
  const buf = fs.readFileSync(path.join(ROME, s.file));
  const nameOff = buf.indexOf(nameBuf);
  if (nameOff < 0) { console.log(s.label + ': recruit entry NOT FOUND'); rows.push(null); continue; }
  const entryOff = nameOff - 6;
  const trailerOff = nameOff + nameBuf.length; // right after name (incl NUL)
  const vals = [];
  for (let k = 0; k + 4 <= 28; k += 4) vals.push(buf.readUInt32LE(trailerOff + k));
  const u16 = [];
  for (let k = 0; k + 2 <= 28; k += 2) u16.push(buf.readUInt16LE(trailerOff + k));
  const tailhex = Array.from(buf.slice(trailerOff, trailerOff + 28)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  rows.push({ label: s.label, entryOff, trailerOff, vals, u16, tailhex, nameOff });
  console.log('\n' + s.label + ': name@0x' + nameOff.toString(16) + ' entry@0x' + entryOff.toString(16));
  console.log('  trailer hex: ' + tailhex);
}

console.log('\n=== Trailer u32 per-turn comparison ===');
console.log(['off', ...saves.map(s => s.label), 'verdict'].map(x => String(x).padEnd(14)).join(''));
const valid = rows.filter(Boolean);
if (valid.length >= 2) {
  const n = Math.max(...valid.map(r => r.vals.length));
  for (let i = 0; i < n; i++) {
    const vs = valid.map(r => r.vals[i]);
    const allEq = vs.every(v => v === vs[0]);
    let verdict = allEq ? 'const' : 'CHANGES';
    console.log(['+' + (i * 4), ...vs, verdict].map(x => String(x).padEnd(14)).join(''));
  }
}

console.log('\n=== Trailer u16 per-turn comparison ===');
console.log(['off', ...saves.map(s => s.label), 'verdict'].map(x => String(x).padEnd(14)).join(''));
if (valid.length >= 2) {
  const n = Math.max(...valid.map(r => r.u16.length));
  for (let i = 0; i < n; i++) {
    const vs = valid.map(r => r.u16[i]);
    const allEq = vs.every(v => v === vs[0]);
    let verdict = allEq ? 'const' : 'CHANGES';
    console.log(['+' + (i * 2), ...vs, verdict].map(x => String(x).padEnd(14)).join(''));
  }
}
