// dig-reputation-11-record-map.js
// Map the FULL faction-record layout across the Spain trajectory and look for
// a per-faction REPUTATION scalar that drifts on the betrayal.
//
// Strategy: identify Spain (row0) + Carthage (row7) by the war-flag flip seen
// in earlier sessions. For each record, find its boundaries (offset -> next
// record's offset) and the diplo marker. Then characterise the record as a
// sequence of u32 / f32 / u8 columns, and track which columns drift across
// T4start -> T4war ONLY for Spain (and Carthage), staying constant for the
// unrelated factions. Reputation is a small bounded scalar (int or float).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const MARKER = 0x39240005;
const SAVES = [
  ['T1',      'save_17-05-2026   Spain   Turn 1.sav'],
  ['T2trade', 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'],
  ['T3end',   'save_Autosave   Spain   Turn 3 End.sav'],
  ['T4start', 'save_Autosave   Spain   Turn 4 Start.sav'],
  ['T4war',   'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav'],
  ['T4bsg',   'save_Autosave   Spain   Turn 4 besiged corduba.sav'],
];

function findRecs(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    out.push({ off: i, treasury: buf.readInt32LE(i) });
  }
  return out;
}

const bufs = {}, recs = {};
for (const [t, f] of SAVES) { bufs[t] = fs.readFileSync(path.join(BASE, f)); recs[t] = findRecs(bufs[t]); }

const tags = SAVES.map(s => s[0]);
console.log('records per turn: ' + tags.map(t => `${t}=${recs[t].length}`).join(' '));

// Map record sizes + marker offsets in T4start
const t0 = 'T4start', buf0 = bufs[t0], rs0 = recs[t0];
console.log('\n=== record map (T4start) ===');
for (let r = 0; r < rs0.length; r++) {
  const cur = rs0[r].off;
  const next = r + 1 < rs0.length ? rs0[r + 1].off : Math.min(buf0.length, cur + 20000);
  const size = next - cur;
  let mk = -1;
  for (let o = cur + 48; o < next - 4; o++) { if (buf0.readUInt32LE(o) === MARKER) { mk = o; break; } }
  console.log(`row${String(r).padStart(2)} off=0x${cur.toString(16)} treas=${rs0[r].treasury} size=${size} marker@+${mk > 0 ? mk - cur : '?'}`);
}
