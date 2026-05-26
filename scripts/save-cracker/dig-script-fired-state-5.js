// dig-script-fired-state-5.js
// Lock down the historic-events record grammar and find where the trigger DATE
// is stored. descr_events gives date as (yearOffset, season). The olympics
// record is the cleanest (no position). Dump its full bytes and align to fields.
//
// Research/diagnostics only.

const fs = require('fs');
const path = require('path');
const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_t0.sav'));

function pstr(o) {
  const lp1 = buf.readUInt16LE(o);
  return { lp1, str: buf.toString('latin1', o + 2, o + 2 + lp1 - 1), total: 2 + lp1 };
}

// Find the table header just before "historic"/"olympics".
const histNeedle = Buffer.concat([Buffer.from([0x09, 0x00]), Buffer.from('historic', 'latin1'), Buffer.from([0])]);
const histAt = buf.indexOf(histNeedle);
console.log('"historic" pstr @0x' + histAt.toString(16));

// Dump 24 bytes before it (table header / count) and the first 3 full records.
function dump(o, n, label) {
  console.log(label + ' @0x' + o.toString(16) + ':');
  for (let r = 0; r < n; r += 16) {
    const s = buf.slice(o + r, o + r + 16);
    const h = Array.from(s).map((x) => x.toString(16).padStart(2, '0')).join(' ');
    const a = Array.from(s).map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('');
    console.log('   0x' + (o + r).toString(16) + ': ' + h + '  ' + a);
  }
}

dump(histAt - 24, 24, 'TABLE HEADER (24B before "historic")');

// u32s in the 24 bytes before — look for an event-count.
console.log('\nPossible count fields before "historic":');
for (let k = 4; k <= 24; k += 4) {
  const v = buf.readUInt32LE(histAt - k);
  console.log('  -' + k + ' = ' + v + ' (0x' + v.toString(16) + ')');
}

// Walk first 3 records and annotate.
console.log('\n=== First 3 records annotated ===');
let p = histAt;
for (let i = 0; i < 3; i++) {
  const cat = pstr(p);
  const name = pstr(p + cat.total);
  const plOff = p + cat.total + name.total;
  console.log(`\nrec[${i}] @0x${p.toString(16)}  cat="${cat.str}" name="${name.str}"  payload@0x${plOff.toString(16)}`);
  dump(plOff, 40, '   payload');
  // field guesses
  console.log('   payload u32s:');
  for (let k = 0; k <= 28; k += 4) {
    const v = buf.readUInt32LE(plOff + k);
    const sv = v > 0x7fffffff ? v - 0x100000000 : v;
    console.log('     +' + k + ' = ' + v + ' (signed ' + sv + ', 0x' + v.toString(16) + ')');
  }
  // advance to next "historic"/category — find next pstr that is a known category
  const cats = new Set(['historic', 'volcano', 'plague', 'earthquake', 'storm', 'flood', 'riot', 'emergent_faction']);
  let q = plOff + 8;
  while (q < plOff + 80) {
    try {
      const c = pstr(q);
      if (cats.has(c.str)) { p = q; break; }
    } catch (e) {}
    q++;
  }
}

// descr_events says: olympics date 1 summer (no position).
// eruption_at_etna_140 date 130 summer, position 311,344, scale 0.
// Confirm which u32 == 130 (year), which == 311/344, which == 0 (scale).
console.log('\n=== Cross-check etna_140 (descr_events: date 130 summer, pos 311,344, scale 0) ===');
const etnaNeedle = Buffer.from('eruption_at_etna_140', 'latin1');
const etnaAt = buf.indexOf(etnaNeedle);
const etnaPl = etnaAt + 'eruption_at_etna_140'.length + 1;
for (let k = 0; k <= 28; k += 4) {
  const v = buf.readUInt32LE(etnaPl + k);
  let note = '';
  if (v === 311) note = '<- X position';
  if (v === 344) note = '<- Y position';
  if (v === 130) note = '<- YEAR offset?';
  console.log('  payload+' + k + ' = ' + v + ' ' + note);
}
