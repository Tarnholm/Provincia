// Read Pella and Sparta populations in T1 to compare to descr_strat

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const T1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const T15 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 15.sav'));

function findPstr16Utf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

// Population is at stats_block + 548 in vanilla.
// stats_block_start = nameOff - 583
// So pop is at nameOff - 583 + 548 = nameOff - 35

function getPop(buf, name) {
  const nameOff = findPstr16Utf16(buf, name);
  if (nameOff === -1) return null;
  // Try several offsets for population (varies by campaign)
  // For Alexander the stats block size might differ
  const candidates = [];
  for (let off = -1000; off < 0; off += 4) {
    const v = buf.readUInt32LE(nameOff + off);
    if (v > 1000 && v < 100000) candidates.push({ off, v });
  }
  return { nameOff, candidates };
}

console.log('=== T1 Pella stats ===');
const pella = getPop(T1, 'Pella');
console.log('  nameOff: 0x' + pella.nameOff.toString(16));
console.log('  Plausible-pop u32s in -1000..0 before name:');
for (const c of pella.candidates.slice(0, 20)) {
  console.log('    off=' + c.off + ' v=' + c.v);
}

console.log('\n=== T1 Sparta stats ===');
const sparta = getPop(T1, 'Sparta');
console.log('  nameOff: 0x' + sparta.nameOff.toString(16));
console.log('  Plausible-pop u32s in -1000..0 before name:');
for (const c of sparta.candidates.slice(0, 20)) {
  console.log('    off=' + c.off + ' v=' + c.v);
}

// Compare to descr_strat expected:
// Pella: pop=4776 (large_town with governors_villa tier 1)
// Sparta: pop=16512 (city with governors_palace tier 2)
console.log('\n=== descr_strat expected (fresh Alexander campaign start) ===');
console.log('  Pella: pop=4776, core_building tier 1 (governors_villa), large_town');
console.log('  Sparta: pop=16512, core_building tier 2 (governors_palace), city');
console.log('\n=== T1 cracker actual ===');
console.log('  Pella: core_building tier 2 (governors_palace) ← TIER 2 (above descr_strat tier 1)');
console.log('  Sparta: core_building tier 4 (imperial_palace) ← TIER 4 (way above descr_strat tier 2)');
