// dig-queue-recruit-fieldmap.js
// Fully map the recruitment queue entry. We have ground truth from EDU:
//   aor etruscan spearmen: stat_cost = 2(turns), 1303(cost), 477(upkeep), 1, 72, 495
// Compare T2 (just queued, elapsed 0) vs T3 (elapsed 1) to separate
// constant fields (unit id / cost / count / turns_total) from changing ones
// (turns_elapsed / gold_paid). Dump a wide window aligned on the unit name.

'use strict';
const fs = require('fs');
const path = require('path');

const ROME = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Rome', 'saves'
);

const nameBuf = Buffer.from('aor etruscan spearmen\0', 'latin1');

function load(file) {
  const buf = fs.readFileSync(path.join(ROME, file));
  // The real queue entry is in the settlement zone (~0xf86000). Restrict search.
  const nameOff = buf.indexOf(nameBuf, 0xf80000);
  if (nameOff < 0 || nameOff > 0x1000000) return null;
  return { buf, nameOff };
}

function u16(b, o) { return b.readUInt16LE(o); }
function u32(b, o) { return b.readUInt32LE(o); }

const T2 = load('save_arretium turn 2 new unit queued.sav');
const T3 = load('save_arretium turn 3.sav');
if (!T2 || !T3) { console.log('missing'); process.exit(1); }

// Anchor: name string. entry starts at name-6 (uuid4 + nameLen2).
// We'll dump from name-32 to name+nameLen+48, aligned, with byte-diff markers.
function regionDump(rec, label) {
  const { buf, nameOff } = rec;
  const start = nameOff - 32;
  const end = nameOff + nameBuf.length + 48;
  console.log(`\n===== ${label}  name@0x${nameOff.toString(16)} =====`);
  for (let o = start; o < end; o += 16) {
    const slice = buf.slice(o, Math.min(o + 16, end));
    const rel = o - nameOff;
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log(`  name${rel >= 0 ? '+' + rel : rel}`.padEnd(12) + `0x${o.toString(16)}: ${hex.padEnd(48)} |${ascii}|`);
  }
}
regionDump(T2, 'T2 (queued, elapsed 0)');
regionDump(T3, 'T3 (elapsed 1)');

// Aligned byte diff over the whole window [name-32 .. name+nameLen+48]
console.log('\n===== Aligned byte diffs (relative to name string start) =====');
for (let rel = -32; rel < nameBuf.length + 48; rel++) {
  const a = T2.buf[T2.nameOff + rel];
  const b = T3.buf[T3.nameOff + rel];
  if (a !== b) {
    console.log(`  name${rel >= 0 ? '+' + rel : rel}: T2=${a} (0x${a.toString(16)})  T3=${b} (0x${b.toString(16)})`);
  }
}

// Map EDU values everywhere in [name-32 .. name+nameLen+48].
// turns=2, cost=1303(0x517), upkeep=477(0x1dd). Also try observed 1317(0x525), 243(0xf3).
console.log('\n===== Search for EDU/observed values as u16 LE in the window =====');
const targets = { 'turns(2)': 2, 'cost(1303)': 1303, 'upkeep(477)': 477, 'obs1317': 1317, 'obs243': 243, 'count?(1)': 1, 'obs10': 10 };
for (const rec of [{ l: 'T2', d: T2 }, { l: 'T3', d: T3 }]) {
  const { buf, nameOff } = rec.d;
  for (const [tlabel, tval] of Object.entries(targets)) {
    const hits = [];
    for (let rel = -32; rel < nameBuf.length + 46; rel++) {
      if (u16(buf, nameOff + rel) === tval) hits.push('name' + (rel >= 0 ? '+' + rel : rel));
    }
    console.log(`  ${rec.l} ${tlabel.padEnd(12)}: ${hits.join(', ') || '(none)'}`);
  }
}

// Trailer u32/u16 field-by-field with verdict.
console.log('\n===== Trailer u32 (from name+nameLen) const vs CHANGES =====');
const trOff2 = T2.nameOff + nameBuf.length;
const trOff3 = T3.nameOff + nameBuf.length;
for (let k = 0; k + 4 <= 32; k += 4) {
  const a = u32(T2.buf, trOff2 + k), b = u32(T3.buf, trOff3 + k);
  console.log(`  tr+${k}`.padEnd(8) + `T2=${a}`.padEnd(16) + `T3=${b}`.padEnd(16) + (a === b ? 'const' : 'CHANGES'));
}
console.log('\n===== Trailer u16 (from name+nameLen) const vs CHANGES =====');
for (let k = 0; k + 2 <= 32; k += 2) {
  const a = u16(T2.buf, trOff2 + k), b = u16(T3.buf, trOff3 + k);
  console.log(`  tr+${k}`.padEnd(8) + `T2=${a}`.padEnd(16) + `T3=${b}`.padEnd(16) + (a === b ? 'const' : 'CHANGES'));
}
