// dig-build-queue-timing.js
// Goal: confirm the per-queue-item "turns" u32 at entry+16 of a default_set
//       BUILDING queue entry is the TURNS REMAINING counter (counts down each
//       turn), not the total construction time.
//
// Strategy:
//   1. Run the existing queueParser on the Macedon T0 save and dump
//      {settlement, chainId, turns, count, entryOff}.
//   2. For each queue item, look up the construction time in
//      export_descr_buildings.txt — the "construction X" field on the level
//      whose chain matches. If `turns` equals the EDB construction value,
//      the field is total turns; if it's lower (and decrements across saves
//      separated by 1 turn), it's "remaining".
//   3. Dump ±64B context around each entry so we can spot any second u32
//      that might be the "total" or "elapsed" counterpart.
//
// Cross-save validation: compare same-settlement queue entries between two
// saves taken 1 turn apart (we have many Spain Turn N / Turn N+1 pairs).

'use strict';

const fs = require('fs');
const path = require('path');

const { parseSettlements, findAllSettlementMarkers } = require('../../src/buildingParser.js');
const { parseQueuesForSettlements, findAllDefaultSets, readQueueAtDefaultSet } = require('../../src/queueParser.js');

const ROME = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const ALEX = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVES = {
  macedonT0: ROME + 'save_macedon t0.sav',
  spainT1: ROME + 'save_17-05-2026   Spain   Turn 1.sav',
  spainT2: ROME + 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav',
  spainT3End: ROME + 'save_Autosave   Spain   Turn 3 End.sav',
  spainT4Start: ROME + 'save_Autosave   Spain   Turn 4 Start.sav',
  spainT4: ROME + 'save_Autosave   Spain   Turn 4.sav',
  arretiumT2new: ROME + 'save_arretium turn 2 new unit queued.sav',
  arretiumT3: ROME + 'save_arretium turn 3.sav',
  arretiumT4: ROME + 'save_arretium turn 4.sav',
};

const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';

// Parse EDB once for level construction times.
// Format snippet:
//   building hinterland_farms
//   {
//       levels land_clearance communal_farming crop_rotation irrigation
//       {
//           land_clearance requires factions ...
//           {
//               capability { ... }
//               construction  1
//               cost  400
//               ...
//           }
//           communal_farming requires ...
//           {
//               ...
//               construction  2
//               ...
//           }
//       }
//   }
//
// Build: { chainName: { levelName: { construction: N, cost: M } } }
function parseEDB(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  let chain = null;
  let level = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/;.*/, '').trim();

    const mb = line.match(/^building\s+(\w+)/);
    if (mb) { chain = mb[1]; if (!out[chain]) out[chain] = {}; level = null; continue; }

    // Level definition: `<name> requires factions ...` (at indentation 2 tabs).
    const ml = line.match(/^([a-z_][a-z_0-9]*)\s+requires\b/);
    if (ml && chain) { level = ml[1]; if (!out[chain][level]) out[chain][level] = {}; continue; }

    const mc = line.match(/^construction\s+(\d+)/);
    if (mc && chain && level) out[chain][level].construction = parseInt(mc[1], 10);
    const mcost = line.match(/^cost\s+(\d+)/);
    if (mcost && chain && level) out[chain][level].cost = parseInt(mcost[1], 10);
  }
  return out;
}

const edbText = fs.readFileSync(EDB, 'utf8');
const edb = parseEDB(edbText);
console.log('EDB chains parsed: ' + Object.keys(edb).length);

// Helper: try to map a queue's chainId hash back to a chain name + level name.
// We don't currently know the chainId hash function, but the parser already
// produces a chainId u32. The most useful thing is to look up the building
// LEVEL pstr16 near the queue entry — the level name is stored as ASCIIZ
// pstr16 a few bytes before/after the entry.
function readPstr16(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 64) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  let asciiOk = true;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) { asciiOk = false; break; }
  }
  if (!asciiOk) return null;
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

function scanQueues(savePath, label) {
  console.log('\n========== ' + label + ' ==========');
  console.log('Path: ' + savePath);
  let buf;
  try { buf = fs.readFileSync(savePath); }
  catch (e) { console.log('  [skipped] cannot read: ' + e.message); return null; }
  console.log('Size: ' + buf.length);

  // Minimal whitelist — we only need settlement detection, not a full chain
  // map. parseSettlements is happy with empty whitelist.
  const { settlements } = parseSettlements(buf, new Set(), {});
  console.log('Settlements found: ' + settlements.length);
  const markers = findAllSettlementMarkers(buf);
  const liveQueues = parseQueuesForSettlements(buf, markers);

  const out = [];
  for (const [city, q] of liveQueues) {
    if (q.building.length === 0) continue;
    for (const b of q.building) {
      out.push({ city, ...b });
    }
  }
  console.log('Building queue items: ' + out.length);
  if (out.length === 0) {
    console.log('  (no building queue items in this save)');
    return { items: [], buf };
  }

  // For each item, re-walk to find the entryOff and dump context.
  const positions = findAllDefaultSets(buf);
  const items = [];
  for (const dsOff of positions) {
    const r = readQueueAtDefaultSet(buf, dsOff);
    if (!r || r.type !== 'building') continue;
    // Find owner settlement.
    let owner = null;
    for (let i = 0; i < markers.length; i++) {
      const cur = markers[i];
      const prevEnd = i === 0 ? 0 : markers[i - 1].blockEnd;
      if (dsOff >= prevEnd && dsOff < cur.offset) { owner = cur.name; break; }
    }
    items.push({ owner, dsOff, ...r });
  }
  for (const it of items) {
    console.log('\n  Settlement: ' + (it.owner || '???'));
    console.log('    default_set @ 0x' + it.dsOff.toString(16));
    console.log('    entry @ 0x' + it.entryOff.toString(16));
    console.log('    chainId=0x' + it.chainId.toString(16) + ' count=' + it.count + ' turns=' + it.turns);
    // Dump 80 bytes after entryOff.
    const sliceStart = it.entryOff;
    const sliceEnd = Math.min(buf.length, it.entryOff + 80);
    const hex = Array.from(buf.slice(sliceStart, sliceEnd)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    console.log('    entry+0..80 hex: ' + hex);

    // Dump u32s
    const u32s = [];
    for (let o = 0; o + 4 <= sliceEnd - sliceStart; o += 4) {
      u32s.push('+' + o + '=' + buf.readUInt32LE(sliceStart + o));
    }
    console.log('    u32s: ' + u32s.join(' '));

    // Look 64 B before entryOff for a level pstr16 (so we can name the building).
    const beforeStart = Math.max(0, it.entryOff - 64);
    for (let p = beforeStart; p < it.entryOff; p++) {
      const s = readPstr16(buf, p);
      if (s && /^[a-z_]+$/.test(s.str)) {
        console.log('    pstr16 before entry @ 0x' + p.toString(16) + ': "' + s.str + '"');
      }
    }
    // Look 80 B AFTER entryOff for level pstr16
    const afterEnd = Math.min(buf.length, it.entryOff + 200);
    for (let p = it.entryOff; p < afterEnd; p++) {
      const s = readPstr16(buf, p);
      if (s && /^[a-z_]+$/.test(s.str)) {
        console.log('    pstr16 after entry  @ 0x' + p.toString(16) + ' (+' + (p - it.entryOff) + '): "' + s.str + '"');
      }
    }
  }
  return { items, buf };
}

const t0 = scanQueues(SAVES.macedonT0, 'Macedon T0 (target)');
const sT1 = scanQueues(SAVES.spainT1, 'Spain T1');
const sT2 = scanQueues(SAVES.spainT2, 'Spain T2 trade offer');
const sT3 = scanQueues(SAVES.spainT3End, 'Spain T3 End');
const sT4S = scanQueues(SAVES.spainT4Start, 'Spain T4 Start');
const sT4 = scanQueues(SAVES.spainT4, 'Spain T4');
const aT2 = scanQueues(SAVES.arretiumT2new, 'Arretium T2 new unit queued');
const aT3 = scanQueues(SAVES.arretiumT3, 'Arretium T3');
const aT4 = scanQueues(SAVES.arretiumT4, 'Arretium T4');
const macSpartaPellaQ = scanQueues(ALEX + 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav', 'Macedon T1 buildings queued in Sparta+Pella');
const macT2retrain = scanQueues(ALEX + 'save_Macedon   Turn 2 retrain unit, repair building and queue new .sav', 'Macedon T2 retrain & queue');
const macT2 = scanQueues(ALEX + 'save_17-05-2026   Macedon   Turn 2.sav', 'Macedon T2');

// Cross-turn comparison: if a settlement has a queued building in BOTH
// consecutive saves with the same chainId, the `turns` should decrement
// by exactly 1.
function compareTurns(a, b, labelA, labelB) {
  if (!a || !b) return;
  console.log('\n========== Cross-turn diff: ' + labelA + ' vs ' + labelB + ' ==========');
  const aBy = new Map();
  for (const it of a.items) {
    const key = (it.owner || '?') + '|' + it.chainId;
    aBy.set(key, it);
  }
  for (const it of b.items) {
    const key = (it.owner || '?') + '|' + it.chainId;
    const prev = aBy.get(key);
    if (!prev) {
      console.log('  [new in ' + labelB + '] ' + key + ' turns=' + it.turns);
      continue;
    }
    const delta = it.turns - prev.turns;
    console.log('  ' + key.padEnd(40) + '  ' + labelA + '.turns=' + prev.turns + '  ' + labelB + '.turns=' + it.turns + '  Δ=' + delta);
  }
  for (const it of a.items) {
    const key = (it.owner || '?') + '|' + it.chainId;
    if (!b.items.find(x => (x.owner || '?') + '|' + x.chainId === key)) {
      console.log('  [completed in ' + labelB + '] ' + key + '  was turns=' + it.turns);
    }
  }
}

compareTurns(sT1, sT2, 'sT1', 'sT2');
compareTurns(sT2, sT3, 'sT2', 'sT3');
compareTurns(sT3, sT4S, 'sT3End', 'sT4Start');
compareTurns(sT4S, sT4, 'sT4Start', 'sT4');
compareTurns(aT2, aT3, 'aT2', 'aT3');
compareTurns(aT3, aT4, 'aT3', 'aT4');

// Lookup EDB construction times for any level names we spotted.
// We don't have a name→chainId hash, but we can compare turn-counter values
// to ALL possible construction times to see what range they fall in.
console.log('\n========== EDB construction-time histogram (RIS) ==========');
const constHist = {};
for (const chain of Object.keys(edb)) {
  for (const lvl of Object.keys(edb[chain])) {
    const c = edb[chain][lvl].construction;
    if (c != null) constHist[c] = (constHist[c] || 0) + 1;
  }
}
const keys = Object.keys(constHist).map(x => parseInt(x, 10)).sort((a, b) => a - b);
console.log('construction → count');
for (const k of keys) console.log('  ' + k + ' turns: ' + constHist[k] + ' levels');
console.log('\nMax construction in RIS EDB: ' + Math.max(...keys));
