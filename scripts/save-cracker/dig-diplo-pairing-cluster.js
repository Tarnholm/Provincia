// dig-diplo-pairing-cluster.js
//
// Investigate the 12-byte-stride cluster found near uuid=412, and dump the
// raw bytes of a diplo entry IN CONTEXT (entry + the bytes immediately
// before/after the 16-byte record) to find any hidden target-faction field.

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
function dump(off, len, label) {
  console.log(`-- ${label} @0x${off.toString(16)} --`);
  for (let r = 0; r < len; r += 16) {
    console.log(`  +${String(r).padStart(3)} ${hex(buf.slice(off + r, off + r + 16))}`);
  }
}

const factionOrder = parseFactionOrder();
const recs = X.parseFactionTreasuries(buf);
const owners = X.identifyFactionRecordOwners(buf, recs, factionOrder);
const diplo = X.parseFactionDiplomacy(buf, recs);

// 1. The 12-byte-stride cluster near 0x1a8b9 (uuid=412)
console.log('=== 12-byte-stride cluster near 0x1a8b9 ===');
dump(0x1a8a0, 0xc0, 'cluster');

// 2. Dump a full diplo block IN CONTEXT for a small faction (acarnania, rec 11)
//    so we can see the marker, count, entries, AND surrounding bytes.
const rIdx = 11;
const mo = diplo[rIdx].markerOffset;
console.log(`\n=== Full diplo block: rec[${rIdx}] ${owners[rIdx].factionName} marker @0x${mo.toString(16)} ===`);
dump(mo - 16, 16 + 8 + diplo[rIdx].relations.length * 16 + 32, 'block+context');
console.log('relations:', JSON.stringify(diplo[rIdx].relations));

// 3. Dump ptolemaic's first few entries with 8 bytes before the marker and
//    show whether anything between count and entries encodes a list of targets.
const pIdx = 2;
const pmo = diplo[pIdx].markerOffset;
console.log(`\n=== ptolemaic diplo header @0x${pmo.toString(16)} (84 entries) ===`);
dump(pmo - 8, 8 + 8 + 16 * 8, 'ptolemaic head (first 8 entries)');

// 4. KEY TEST: maybe a TARGET faction-id is encoded somewhere adjacent. The
//    16-byte entry is uuid/class/attitude/tag. Check: is there a PARALLEL
//    array AFTER all the 16-byte entries (e.g., a list of target faction ids)?
//    Dump the bytes immediately AFTER ptolemaic's 84 entries.
const pAfter = pmo + 8 + 84 * 16;
console.log(`\n=== Bytes AFTER ptolemaic's 84 entries @0x${pAfter.toString(16)} ===`);
dump(pAfter, 0x80, 'after-entries');
