// dig-queue-recruit-fullentry.js
// Decode the FULL recruit entry incl. the bytes before the uuid (the queue
// count / list framing) for T2 and T3, aligned identically. Determine the
// true field boundaries: cost, count, turns_total, turns_elapsed/gold.

'use strict';
const fs = require('fs');
const path = require('path');

const ROME = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Rome', 'saves'
);

const nameBuf = Buffer.from('aor etruscan spearmen\0', 'latin1');

function dumpEntry(file, label) {
  const buf = fs.readFileSync(path.join(ROME, file));
  // restrict to first half so we don't hit a governor-name false match
  const nameOff = buf.indexOf(nameBuf, 0xf80000);
  if (nameOff < 0 || nameOff > 0x1000000) { console.log(label + ': not found in queue zone'); return null; }
  const uuidOff = nameOff - 6;             // uuid(4) + nameLen(2)
  // Show 20 bytes before uuid (queue framing) through 28 after name.
  const start = uuidOff - 20;
  const end = nameOff + nameBuf.length + 28;
  console.log('\n===== ' + label + '  (name@0x' + nameOff.toString(16) + ', entry@0x' + uuidOff.toString(16) + ') =====');
  for (let o = start; o < end; o += 16) {
    const slice = buf.slice(o, Math.min(o + 16, end));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    let m = '   ';
    if (o + 16 <= uuidOff) m = 'pre';
    else if (o >= nameOff + nameBuf.length) m = 'tlr';
    else m = 'ent';
    console.log('  ' + m + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + ' |' + ascii + '|');
  }
  return { buf, nameOff, uuidOff, trailerOff: nameOff + nameBuf.length };
}

const t2 = dumpEntry('save_arretium turn 2 new unit queued.sav', 'T2 queued (elapsed 0)');
const t3 = dumpEntry('save_arretium turn 3.sav', 'T3 (elapsed 1)');

// Byte-by-byte diff of the trailer between T2 and T3, only show diffs.
if (t2 && t3) {
  console.log('\n=== T2 vs T3 byte diffs in trailer (relative to trailerOff) ===');
  for (let k = 0; k < 28; k++) {
    const a = t2.buf[t2.trailerOff + k];
    const b = t3.buf[t3.trailerOff + k];
    if (a !== b) console.log('  trailer+' + k + ': T2=' + a + ' (0x' + a.toString(16) + ')  T3=' + b + ' (0x' + b.toString(16) + ')');
  }
  // Read the gold-paid candidate as u16 at trailer+4..+6
  console.log('\nInterpretations:');
  for (const r of [{ l: 'T2', d: t2 }, { l: 'T3', d: t3 }]) {
    const tr = r.d.trailerOff;
    console.log('  ' + r.l + ': u32@tr+4=' + r.d.buf.readUInt32LE(tr + 4) +
      '  u16@tr+5=' + r.d.buf.readUInt16LE(tr + 5) +
      '  cost u16@tr+8=' + r.d.buf.readUInt16LE(tr + 8) +
      '  count u32@tr+12=' + r.d.buf.readUInt32LE(tr + 12) +
      '  u32@tr+16=' + r.d.buf.readUInt32LE(tr + 16) +
      '  u32@tr+20=' + r.d.buf.readUInt32LE(tr + 20));
  }
}
