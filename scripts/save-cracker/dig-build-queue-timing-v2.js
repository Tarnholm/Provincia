// dig-build-queue-timing-v2.js
// Deeper look at the 3 known queue entries (Arretium T2/T3/T4).
// Goal: explicitly confirm which u32 is "remaining turns".

'use strict';
const fs = require('fs');

const ROME = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const saves = [
  { label: 'aT2 (Gades chainId=4000)',   path: ROME + 'save_arretium turn 2 new unit queued.sav', dsOff: 0x11e11ec, entryOff: 0x11e122d },
  { label: 'aT3 (Ankyra chainId=4000)',  path: ROME + 'save_arretium turn 3.sav',                  dsOff: 0x11e74de, entryOff: 0x11e751f },
  { label: 'aT4 (Ankyra chainId=4000)',  path: ROME + 'save_arretium turn 4.sav',                  dsOff: 0x11ef42e, entryOff: 0x11ef46f },
];

function dumpU32s(buf, start, end, label) {
  const u = [];
  for (let o = start; o + 4 <= end; o += 4) {
    u.push((o-start).toString().padStart(3, ' ') + ':' + buf.readUInt32LE(o));
  }
  console.log('  ' + label + '\n    ' + u.join('  '));
}

for (const s of saves) {
  const buf = fs.readFileSync(s.path);
  console.log('\n========== ' + s.label + ' ==========');
  // Dump default_set body header (right after "default_set\0" = 12 B)
  const bodyStart = s.dsOff + 12;
  console.log('default_set bodyStart=0x' + bodyStart.toString(16) + '  entryOff=0x' + s.entryOff.toString(16) + '  Δ=' + (s.entryOff - bodyStart));
  dumpU32s(buf, bodyStart, bodyStart + 56, 'default_set body header (56 B)');
  // Dump the queue entry itself, 56 bytes.
  dumpU32s(buf, s.entryOff, s.entryOff + 56, 'queue entry (56 B)');
  // Dump 32 B BEFORE entry to look for cached counters
  dumpU32s(buf, s.entryOff - 32, s.entryOff, 'pre-entry (32 B)');

  // Show raw hex of entry
  const hex = Array.from(buf.slice(s.entryOff, s.entryOff + 56)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log('  entry raw: ' + hex);
}

// Side-by-side u32 comparison of the 3 entries
console.log('\n========== u32 comparison across saves ==========');
const data = saves.map(s => {
  const buf = fs.readFileSync(s.path);
  const arr = [];
  for (let o = 0; o < 56; o += 4) arr.push(buf.readUInt32LE(s.entryOff + o));
  return arr;
});
console.log(['offset', 'aT2 (Gades)', 'aT3 (Ankyra)', 'aT4 (Ankyra)', 'changes?'].map(x => String(x).padEnd(15)).join(''));
for (let i = 0; i < 14; i++) {
  const off = i * 4;
  const vals = data.map(d => d[i]);
  const allEq = vals.every(v => v === vals[0]);
  const t2t3Eq = vals[0] === vals[1];
  const t3t4Eq = vals[1] === vals[2];
  let tag = '';
  if (allEq) tag = '(const)';
  else if (t2t3Eq) tag = 'T3→T4 only';
  else if (t3t4Eq) tag = 'T2→T3 only';
  else tag = 'EACH turn';
  console.log(['+' + off, vals[0], vals[1], vals[2], tag].map(x => String(x).padEnd(15)).join(''));
}
console.log('\nExpected build duration for hinterland_region->region_base is `construction 1` in RIS EDB,');
console.log('but the queue says turns=6. This is suspicious unless the cost (100) is converted into a');
console.log('per-cost-paid number of turns. Or chainId=0xfa0=4000 is not the chain hash but the COST.');
console.log('');
console.log('Note: T2 Gades entry+20=1 entry+24=16. T3 Ankyra entry+20=2 entry+24=33.');
console.log('T4 Ankyra entry+20=3 entry+24=50. So +20 counts UP +1/turn, +24 increases ~17/turn.');
console.log('+24 is gold paid into construction (mod-specific construction cost per turn).');
console.log('+20 is ELAPSED turns. +16 is TOTAL turns. turns_remaining = +16 - +20.');
