// Session 22: Verify the +52+4N+188 turn counter hypothesis for RIS imperial.
// Also, examine the broader structure: look for the equivalent of Alex's
// per-faction stats block in RIS, given the layout differs.
//
// We know: T1 → T5 = 4 turns. +188 ticks 0 → 4 = exactly 1 per turn.
// Hypothesis: +188 = "turns since campaign start" (per-faction).
//
// In Alex (5 factions, sessions 21), the counter A at +(92+4N+20) ticked
// 0→9 across 99 turns. That's NOT per-turn (would be 99). So the Alex A
// counter is "events" not "turns".
//
// For RIS: is +188 = turns? Let's verify by counting +188 values in rome10 only
// to see if all 23 factions have the same value (would be true for turns) or
// different values (would be event count).

const fs = require('fs');

const SAVES = [
  { label: 'rome10 (T5)', path: 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav' },
  { label: 'romeT1', path: 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav' },
];

function findMajorFactionRecords(buf) {
  const recs = [];
  const n = buf.length;
  for (let i = 0; i + 100 < n; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const N = buf.readUInt32LE(i + 48);
    if (N > 200) continue;
    recs.push({ offset: i, treasury: buf.readInt32LE(i), N });
  }
  return recs;
}

for (const s of SAVES) {
  const buf = fs.readFileSync(s.path);
  const recs = findMajorFactionRecords(buf);
  console.log(`\n=== ${s.label}: ${recs.length} major factions ===`);
  console.log('F#  N    treas    +184   +188   +192       +196 +200 +208 +212    +220 +224');
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const base = r.offset + 52 + r.N * 4;
    const v = (off) => buf.readUInt32LE(base + off);
    console.log(`${String(i).padStart(2)}  ${String(r.N).padStart(3)} ${String(r.treasury).padStart(7)}  ${String(v(184)).padStart(6)} ${String(v(188)).padStart(6)} ${String(v(192)).padStart(10)} ${String(v(196)).padStart(4)} ${String(v(200)).padStart(4)} ${String(v(208)).padStart(4)} ${String(v(212)).padStart(7)} ${String(v(220)).padStart(7)} ${String(v(224)).padStart(8)}`);
  }
}
