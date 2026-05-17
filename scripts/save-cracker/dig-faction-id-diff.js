// Compare settlement-owner table at 0x1190 across T1 → T4.
// Spain should have a STABLE 4-settlement count (unless Carthage captured one).
// Carthage should show conquest activity.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

const TURN_FILES = {
  1: 'save_17-05-2026   Spain   Turn 1.sav',
  2: 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav',
  3: 'save_Autosave   Spain   Turn 3 End.sav',
  4: 'save_Autosave   Spain   Turn 4 Start.sav',
};
const BUFFERS = {};
for (const t of [1, 2, 3, 4]) BUFFERS[t] = fs.readFileSync(path.join(BASE, TURN_FILES[t]));

// Parse the owner table for each turn
function parseOwnerTable(buf) {
  const entries = [];
  for (let off = 0x1190; off < 0x14a0; off += 12) {
    if (off + 12 > buf.length) break;
    const packed = buf.readUInt32LE(off);
    const facId = buf.readUInt32LE(off + 4);
    const owner = buf.readUInt32LE(off + 8);
    if (facId > 30) break;
    // Decode the packed coord: low 16 bits = 0x2001 or 0x0004, high 16 bits = region_id
    const regionId = (packed >> 16) & 0xffff;
    const flag = packed & 0xffff;
    entries.push({ off, regionId, flag, facId, owner });
  }
  return entries;
}

for (const t of [1, 2, 3, 4]) {
  const entries = parseOwnerTable(BUFFERS[t]);
  console.log('\n=== T' + t + ' owner table (' + entries.length + ' entries) ===');
  // Count per faction-id
  const counts = {};
  for (const e of entries) counts[e.facId] = (counts[e.facId] || 0) + 1;
  for (const [fid, n] of Object.entries(counts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    console.log('  fac=' + fid + ': ' + n + ' settlements');
  }
}

// Identify which faction-id has SETTLEMENTS WITH region IDs corresponding to Spain.
// Spain in vanilla 270 BC owns: Hispania, Baetica, Celtiberia, Gallaecia (approximate regions)
// These region indices in vanilla descr_regions.txt are around 105-110

// Look for changes between T1 and T4
console.log('\n=== Owner table diff: T1 → T4 ===');
const t1Entries = parseOwnerTable(BUFFERS[1]);
const t4Entries = parseOwnerTable(BUFFERS[4]);

// Map (regionId, facId) → entry. Look for region changes (transfers)
const t1Map = new Map();
const t4Map = new Map();
for (const e of t1Entries) t1Map.set(e.regionId, e);
for (const e of t4Entries) t4Map.set(e.regionId, e);

const allRegions = new Set([...t1Map.keys(), ...t4Map.keys()]);
let transfers = 0;
for (const r of allRegions) {
  const t1 = t1Map.get(r);
  const t4 = t4Map.get(r);
  if (!t1 || !t4) {
    console.log('  Region ' + r + ': T1=' + (t1 ? 'fac' + t1.facId : 'absent') + ' T4=' + (t4 ? 'fac' + t4.facId : 'absent'));
    transfers++;
  } else if (t1.facId !== t4.facId) {
    console.log('  Region ' + r + ': T1=fac' + t1.facId + ' → T4=fac' + t4.facId);
    transfers++;
  }
}
console.log('Total transfers: ' + transfers);

// Sanity check faction counts T1 vs T4
console.log('\n=== Faction settlement count changes T1 → T4 ===');
const t1Counts = {};
const t4Counts = {};
for (const e of t1Entries) t1Counts[e.facId] = (t1Counts[e.facId] || 0) + 1;
for (const e of t4Entries) t4Counts[e.facId] = (t4Counts[e.facId] || 0) + 1;
for (const fid of Object.keys({...t1Counts, ...t4Counts}).sort((a, b) => parseInt(a) - parseInt(b))) {
  const diff = (t4Counts[fid] || 0) - (t1Counts[fid] || 0);
  console.log('  fac=' + fid + ': T1=' + (t1Counts[fid] || 0) + ' T4=' + (t4Counts[fid] || 0) + (diff !== 0 ? '  Δ=' + (diff > 0 ? '+' : '') + diff : ''));
}
