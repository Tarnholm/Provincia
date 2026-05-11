#!/usr/bin/env node
// Walk the Pella sub-record list in both A and B, parse the structure:
// [u32 self-ptr][u16 nameLen][ASCIIZ name][payload]
// Identify which sub-records exist in each, and where they differ.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

const aPellaName = 0x10d8c;
const bPellaName = 0x10d8c;

// Settlement record fwd portion starts ~name+5 (after the UTF16 name)
// then has fcfcfcfc filler and starts the building chains.
function walkSubrecords(buf, startOff, endOff) {
  // Search for ASCII strings preceded by `04 LEN_LO 00 00 00` (u16 length prefix?)
  // Actually session 3 says `[u32 self-ptr][u16 nameLen][ASCIIZ name][payload]`
  // Simpler: scan for known building chain names
  const knownNames = [
    'default_set', 'hinterland_region', 'core_building', 'core_castle_building',
    'governmentA', 'governmentB', 'governmentC', 'governmentD', 'governmentE',
    'town_walls', 'theatres', 'port_buildings', 'hinterland_roads',
    'temple_of_olympian', 'temple_of_chthonic', 'temple_of_governors',
    'temple_of_apollo', 'temple_of_zeus', 'temple_of_ares', 'temple_of_athena',
    'barracks', 'archery_range', 'stables', 'shrine', 'temple',
    'amphitheatres', 'baths', 'wonder', 'sewers', 'aqueduct',
    'hinterland_roads', 'hinterland_farms', 'roads', 'farms',
    'mining', 'trader', 'market', 'merchants',
    'highway', 'fortified', 'gateway',
    'caesars_imp_palace', 'military_industrial_complex',
    'defenses', 'missiles', 'health', 'cavalry',
    'guilds', 'wonders',
  ];

  const found = [];
  for (const name of knownNames) {
    let pos = startOff;
    while (pos < endOff) {
      const cstr = Buffer.from(name + '\0');
      const hit = buf.indexOf(cstr, pos);
      if (hit < 0 || hit > endOff) break;
      // Header should be `[u32 self-ptr][u16 nameLen][ASCIIZ name]`
      // nameLen u16 sits at hit - 2
      const nameLen = buf.readUInt16LE(hit - 2);
      if (nameLen === name.length) {
        found.push({ name, hit, nameLen, headerOff: hit - 6 });
      }
      pos = hit + 1;
    }
  }
  return found.sort((a, b) => a.hit - b.hit);
}

const aSubs = walkSubrecords(A, aPellaName + 5, aPellaName + 3500);
const bSubs = walkSubrecords(B, bPellaName + 5, bPellaName + 3500);

console.log(`A (saveturn1start) Pella sub-records:`);
for (const s of aSubs) {
  console.log(`  0x${s.hit.toString(16)} (rel +${s.hit - aPellaName}): "${s.name}"`);
}

console.log(`\nB (saveturn1construction) Pella sub-records:`);
for (const s of bSubs) {
  console.log(`  0x${s.hit.toString(16)} (rel +${s.hit - bPellaName}): "${s.name}"`);
}

// Now also look BEFORE the settlement name marker (settlement record starts there)
// At the beginning of the record (~aName - 2270), there's typically pre-name structural data.
// Look for ASCII strings in -2270..0
console.log(`\n=== Backward sub-records (in record header region) ===`);
const aSubsBack = walkSubrecords(A, aPellaName - 2500, aPellaName);
const bSubsBack = walkSubrecords(B, bPellaName - 2500, bPellaName);

console.log(`A backward sub-records (before name):`);
for (const s of aSubsBack) {
  console.log(`  0x${s.hit.toString(16)} (rel ${s.hit - aPellaName}): "${s.name}"`);
}
console.log(`B backward sub-records (before name):`);
for (const s of bSubsBack) {
  console.log(`  0x${s.hit.toString(16)} (rel ${s.hit - bPellaName}): "${s.name}"`);
}

// Detect new/removed sub-records
const aSet = new Set(aSubs.map(s => s.name + '@' + (s.hit - aPellaName)));
const bSet = new Set(bSubs.map(s => s.name + '@' + (s.hit - bPellaName)));

// Compare just by name (ignoring position) — A and B should both have the same set of named chains
const aNames = aSubs.map(s => s.name).sort();
const bNames = bSubs.map(s => s.name).sort();
console.log(`\nA sub-record names (sorted): ${aNames.join(', ')}`);
console.log(`B sub-record names (sorted): ${bNames.join(', ')}`);

// Now the structure question — looking at the diff hot zone, the building chain section in B
// has had ~70 bytes of new content INSERTED at +91..+158. This new content includes
// a sub-record that's prefixed by some kind of "construction queue header".
// Look at the bytes at A[aPellaName+91..+158] and B[bPellaName+91..+158]
console.log(`\n=== Insert hotzone bytes ===`);
console.log(`A @ name+50..+158:`);
console.log(`  ${A.slice(aPellaName+50, aPellaName+158).toString('hex')}`);
console.log(`B @ name+50..+158:`);
console.log(`  ${B.slice(bPellaName+50, bPellaName+158).toString('hex')}`);

// In B, the sub-record offset pattern starts to be different.
// "20 03" (u16 = 800) at offset +67/+68 in B. That's the construction cost? Or building id?
