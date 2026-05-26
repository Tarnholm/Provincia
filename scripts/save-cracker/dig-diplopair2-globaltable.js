// dig-diplopair2-globaltable.js
//
// ANGLE 2: a relation uuid is a GLOBAL creation counter. If there is a separate
// global join table mapping uuid -> (factionA, factionB), it would contain the
// relationUuid values somewhere OTHER than the diplomacy zones. We search the
// whole save for occurrences of each relationUuid as a u32, EXCLUDING the
// known zone-entry offsets. If a uuid appears elsewhere with two faction-id
// bytes adjacent, that's the join table.
//
// Strategy:
//  1. Collect all (uuid -> ownerFid, entryOff) from zones.
//  2. For a sample of uuids, find ALL u32 occurrences in the buffer.
//  3. Classify each occurrence: is it the zone entry? something else?
//  4. For non-zone occurrences, dump surrounding bytes and look for the
//     OWNER fid and a candidate PARTNER fid nearby.

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav';
const buf = fs.readFileSync(SAVE);
const fo = L.parseFactionOrder();
const zones = L.dedupZones(L.parseZones(buf, fo));

// uuid -> { fid, entryOff }
const uuidInfo = new Map();
const entryOffsets = new Set();
for (const z of zones) for (const r of z.relations) { uuidInfo.set(r.uuid, { fid: z.fid, entryOff: r.entryOff, owner: z.name, class_: r.class_ }); entryOffsets.add(r.entryOff); }

// Build index of every u32 value -> list of offsets (only for values in our uuid set, to keep it cheap)
const uuidSet = new Set(uuidInfo.keys());
const occ = new Map(); // uuid -> [offsets]
for (let i = 0; i + 4 <= buf.length; i++) {
  const v = buf.readUInt32LE(i);
  if (v > 1400 || v < 10) continue; // uuids are 12..1322
  if (!uuidSet.has(v)) continue;
  if (!occ.has(v)) occ.set(v, []);
  occ.get(v).push(i);
}

// Stats: how many uuids occur exactly once (only in their zone entry)?
let onceOnly = 0, multiOcc = 0;
const multiSamples = [];
for (const [u, offs] of occ) {
  const nonEntry = offs.filter(o => !entryOffsets.has(o));
  if (nonEntry.length === 0) onceOnly++;
  else { multiOcc++; if (multiSamples.length < 40) multiSamples.push({ u, offs, nonEntry }); }
}
console.log('uuids occurring ONLY in their zone entry:', onceOnly);
console.log('uuids occurring ALSO elsewhere:', multiOcc);

// For multi-occurrence uuids, dump surrounding bytes of the NON-entry occurrence
console.log('\n=== Non-zone occurrences of relation uuids (potential join table) ===');
function hex(off, len) { const o = []; for (let i = 0; i < len; i++) { const p = off + i; o.push(p >= 0 && p < buf.length ? buf[p].toString(16).padStart(2, '0') : '..'); } return o.join(' '); }
let shown = 0;
for (const s of multiSamples) {
  if (shown >= 25) break;
  const info = uuidInfo.get(s.u);
  for (const off of s.nonEntry) {
    if (shown >= 25) break;
    console.log(`uuid=${s.u} owner=${info.owner}(fid${info.fid}) cls=${info.class_} @0x${off.toString(16)} (-8..+16): ${hex(off - 8, 24)}`);
    shown++;
  }
}

// Specifically test the "join table" idea: a region where uuids appear in a
// dense run. Find the offset region with the highest density of uuid u32s
// OUTSIDE the zones.
console.log('\n=== Density of uuid u32s in 4KB windows (excluding zone bodies) ===');
const zoneRanges = zones.map(z => [z.markerOffset, z.endOff]);
function inZone(o) { for (const [a, b] of zoneRanges) if (o >= a && o < b) return true; return false; }
const windows = new Map();
for (const [u, offs] of occ) for (const o of offs) {
  if (inZone(o)) continue;
  const w = Math.floor(o / 4096);
  windows.set(w, (windows.get(w) || 0) + 1);
}
const topW = [...windows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [w, c] of topW) console.log(`  window 0x${(w * 4096).toString(16)}: ${c} uuid-u32s`);
