// dig-reputation-10-flag-trajectory.js
// Track the +100/+104/+108 flags AND the +124 value across the full Spain
// trajectory T1..T4war for EVERY record. Identify which record is the player
// (Spain) and which is Carthage by following the war-flag flip, then read the
// trajectory of all bounded body scalars (+96..+124) per record per turn.
//
// Also: scan the WHOLE record body region [+44 .. marker] for any byte that
// is bounded (<=200) and changes monotonically / drifts across turns -> a
// reputation candidate.

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
    let mk = -1;
    for (let o = i + 48; o < Math.min(buf.length - 4, i + 4096); o += 1) {
      if (buf.readUInt32LE(o) === MARKER) { mk = o; break; }
    }
    out.push({ off: i, treasury: buf.readInt32LE(i), marker: mk, p44: buf.readUInt32LE(i+44) });
  }
  return out;
}

// Records keep their POSITIONAL ORDER across saves (the survey showed treasury
// trajectory aligns by row index). Use row index as the faction key.
const perTurn = {};
for (const [tag, file] of SAVES) {
  perTurn[tag] = findRecs(fs.readFileSync(path.join(BASE, file)));
}
const bufs = {};
for (const [tag, file] of SAVES) bufs[tag] = fs.readFileSync(path.join(BASE, file));

const tags = SAVES.map(s => s[0]);
const N = perTurn[tags[0]].length;
console.log('records per turn: ' + tags.map(t => `${t}=${perTurn[t].length}`).join(' '));

console.log('\n=== Per-record(row) trajectory of +100,+104,+108 flags and +124 ===');
for (let r = 0; r < N; r++) {
  const cells = [];
  for (const t of tags) {
    const rec = perTurn[t][r];
    if (!rec) { cells.push(`${t}:--`); continue; }
    const buf = bufs[t];
    const f100 = buf[rec.off+100], f104 = buf[rec.off+104], f108 = buf[rec.off+108];
    const v124 = buf.readUInt32LE(rec.off+124);
    cells.push(`${t}:${f100}${f104}${f108}/${v124}`);
  }
  console.log(`  row${String(r).padStart(2)} treas(T1=${perTurn['T1'][r]?.treasury}) ` + cells.join('  '));
}
