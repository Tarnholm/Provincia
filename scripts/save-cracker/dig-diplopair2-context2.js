// dig-diplopair2-context2.js — hex context around zones (fixed faction order).
const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav';
const buf = fs.readFileSync(SAVE);
const fo = L.parseFactionOrder();
const zones = L.dedupZones(L.parseZones(buf, fo));
const find = nm => zones.find(z => z.name === nm);

function hex(off, len) {
  const out = [];
  for (let i = 0; i < len; i++) out.push(buf[off + i].toString(16).padStart(2, '0'));
  return out.join(' ');
}

// (A) full 53-byte preamble before marker for several zones
console.log('=== (A) preamble: marker-53 .. marker+8 ===');
for (const nm of ['bactria', 'armenia', 'antigonid']) {
  const z = find(nm); if (!z) { console.log(nm, 'missing'); continue; }
  console.log(`\n${nm} fid=${z.fid} count=${z.count} marker@0x${z.markerOffset.toString(16)}`);
  // Show 60 before in rows of 16
  for (let r = -64; r < 16; r += 16) {
    console.log(`  ${(r>=0?'+':'')}${r}: ${hex(z.markerOffset + r, 16)}`);
  }
}

// (B) full entries + 80 bytes after for bactria & armenia (small, GT-known)
console.log('\n=== (B) bactria entries + trailer ===');
for (const nm of ['bactria', 'armenia']) {
  const z = find(nm); if (!z) continue;
  console.log(`\n${nm} (count=${z.count})`);
  for (const r of z.relations) console.log(`   uuid=${r.uuid} cls=${r.class_} att=${r.attitude} tag=0x${r.tag.toString(16)} | ${hex(r.entryOff, 16)}`);
  console.log('   trailer(80):');
  for (let r = 0; r < 80; r += 16) console.log('     ' + hex(z.endOff + r, 16));
}

// (C) GT: which GT factions actually have a zone? List present/absent.
const gt = L.parseGT();
const zoneNames = new Set(zones.map(z => z.name));
const gtFac = new Set();
for (const k of gt.keys()) { const [a, b] = k.split('|'); gtFac.add(a); gtFac.add(b); }
const present = [...gtFac].filter(f => zoneNames.has(f));
const absent = [...gtFac].filter(f => !zoneNames.has(f));
console.log('\n=== (C) GT-faction zone presence ===');
console.log('GT factions WITH zone:', present.sort().join(', '));
console.log('GT factions WITHOUT zone:', absent.sort().join(', '));
let gtBoth = 0;
for (const k of gt.keys()) { const [a, b] = k.split('|'); if (zoneNames.has(a) && zoneNames.has(b)) gtBoth++; }
console.log('GT pairs where BOTH present:', gtBoth, 'of', gt.size);
