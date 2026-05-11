#!/usr/bin/env node
// Quick attempt at finding per-faction military upkeep aggregate.
// Use the Macedon Turn 97 → Turn 98 End → Turn 99 Start sequence.
// Method: re-locate major-faction records (per session 5), check for u32 fields that
// scale linearly with army size.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';

const saves = [
  'save_Autosave   Macedon   Turn 97.sav',
  'save_Autosave   Macedon   Turn 98 End.sav',
  'save_Autosave   Macedon   Turn 99 Start.sav',
];

function findMajorFactionRecords(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    const treasury = buf.readInt32LE(i);
    out.push({ pos: i, treasury, regions });
  }
  return out;
}

console.log('=== Major-faction records across Alexander campaign saves ===');
for (const s of saves) {
  const buf = fs.readFileSync(path.join(dir, s));
  const recs = findMajorFactionRecords(buf);
  console.log(`\n${s} (${buf.length} bytes): ${recs.length} major records`);
  for (let i = 0; i < Math.min(recs.length, 10); i++) {
    const r = recs[i];
    console.log(`  idx ${i}: pos=0x${r.pos.toString(16)} treasury=${r.treasury} regions=${r.regions}`);
  }
}

// Now do minor faction records too
function findMinorFactionRecords(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 8) continue;
    const treasury = buf.readInt32LE(i);
    out.push({ pos: i, treasury });
  }
  return out;
}

console.log('\n=== Minor-faction records (idx 0 = player Macedon) ===');
for (const s of saves) {
  const buf = fs.readFileSync(path.join(dir, s));
  const minors = findMinorFactionRecords(buf);
  console.log(`\n${s}: ${minors.length} minor records`);
  for (let i = 0; i < Math.min(minors.length, 5); i++) {
    const r = minors[i];
    console.log(`  idx ${i}: pos=0x${r.pos.toString(16)} treasury=${r.treasury}`);
  }
}
