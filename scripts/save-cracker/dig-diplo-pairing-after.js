// dig-diplo-pairing-after.js
//
// The bytes AFTER each faction's diplo entries contain `ef 00 00 00` (=239,
// total faction count) markers. Hypothesis: a per-faction-indexed array
// (239 slots) follows, possibly listing relation/attitude toward EVERY
// faction by INDEX -> giving us the target-faction mapping directly.
//
// Dump a large window after several factions' diplo blocks and look for a
// 239-length structure.

const fs = require('fs');
const X = require('../../src/saveCrackerExtras.js');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const buf = fs.readFileSync(SAVE);

function parseFactionOrder() {
  const txt = fs.readFileSync('C:/RIS/RIS/data/descr_sm_factions.txt', 'utf8');
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur && /^\s*"culture":/.test(line)) { order.push(cur); cur = null; }
  }
  return order;
}
function hex(slice) { return Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' '); }
function ascii(slice){ return Array.from(slice).map(x => (x>=0x20&&x<0x7f)?String.fromCharCode(x):'.').join(''); }
function dump(off, len, label) {
  console.log(`-- ${label} @0x${off.toString(16)} --`);
  for (let r = 0; r < len; r += 16) {
    const s = buf.slice(off + r, off + r + 16);
    console.log(`  +${String(r).padStart(4)} ${hex(s).padEnd(48)} ${ascii(s)}`);
  }
}

const factionOrder = parseFactionOrder();
const recs = X.parseFactionTreasuries(buf);
const owners = X.identifyFactionRecordOwners(buf, recs, factionOrder);
const diplo = X.parseFactionDiplomacy(buf, recs);

// For acarnania (small, 3 relations) dump a big region after the entries so
// we can read the whole trailer up to the NEXT faction record.
const rIdx = 11;
const mo = diplo[rIdx].markerOffset;
const count = buf.readUInt32LE(mo + 4);
const after = mo + 8 + count * 16;
const nextRec = recs[rIdx + 1] ? recs[rIdx + 1].offset : buf.length;
console.log(`rec[${rIdx}] ${owners[rIdx].factionName}: diplo after=0x${after.toString(16)}, next record @0x${nextRec.toString(16)}, gap=${nextRec - after} bytes`);
dump(after, Math.min(nextRec - after, 0x400), 'acarnania trailer');
