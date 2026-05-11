// Session 22: zoom in on the structurally-consistent diffs found in counter2:
// +52+4N+148 and +172 have small deltas that look like faction-specific increments.
// +52+4N+188 is T1=0→T5=4 across ALL factions (constant +4).
//
// Maybe the RIS event counter is at +52+4N+188.
// Let me dump just those critical offsets for all 23 factions.

const fs = require('fs');

const SAVES = [
  { label: 'rome10', path: 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav' },
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

const data = SAVES.map(s => ({ label: s.label, buf: fs.readFileSync(s.path), recs: null }));
for (const d of data) d.recs = findMajorFactionRecords(d.buf);

// Print value at +52+4N+188 across all factions in both saves
console.log('=== +52+4N+188 (consistent T1→T5 +4 delta) ===');
console.log('  F#  | N   | rome10(T5) | romeT1(T1) | delta');
for (let i = 0; i < 23; i++) {
  const r0 = data[1].recs[i], r1 = data[0].recs[i];
  const v0 = data[1].buf.readUInt32LE(r0.offset + 52 + r0.N * 4 + 188);
  const v1 = data[0].buf.readUInt32LE(r1.offset + 52 + r1.N * 4 + 188);
  console.log(`  ${String(i).padStart(2)}  | ${String(r0.N).padStart(3)} | ${String(v1).padStart(10)} | ${String(v0).padStart(10)} | ${v1 - v0}`);
}

// Also +148 and +172 (faction-specific increments)
console.log('\n=== +52+4N+148 and +172 (correlated u32 fields) ===');
console.log('  F#  | +148 T1     | +148 T5     | delta | +172 T1   | +172 T5   | delta');
for (let i = 0; i < 23; i++) {
  const r0 = data[1].recs[i], r1 = data[0].recs[i];
  const v0_148 = data[1].buf.readUInt32LE(r0.offset + 52 + r0.N * 4 + 148);
  const v1_148 = data[0].buf.readUInt32LE(r1.offset + 52 + r1.N * 4 + 148);
  const v0_172 = data[1].buf.readUInt32LE(r0.offset + 52 + r0.N * 4 + 172);
  const v1_172 = data[0].buf.readUInt32LE(r1.offset + 52 + r1.N * 4 + 172);
  console.log(`  ${String(i).padStart(2)}  | ${String(v0_148).padStart(11)} | ${String(v1_148).padStart(11)} | ${String(v1_148-v0_148).padStart(5)} | ${String(v0_172).padStart(9)} | ${String(v1_172).padStart(9)} | ${String(v1_172-v0_172).padStart(5)}`);
}

// And +208, +224, +240 — the bytes that showed varying small deltas
console.log('\n=== +208, +224, +240 (smaller variable fields) ===');
console.log('  F#  | +208 T1 | +208 T5 | +224 T1 | +224 T5 | +240 T1 | +240 T5');
for (let i = 0; i < 23; i++) {
  const r0 = data[1].recs[i], r1 = data[0].recs[i];
  const get = (d, r, off) => d.buf.readUInt32LE(r.offset + 52 + r.N * 4 + off);
  console.log(`  ${String(i).padStart(2)}  | ${String(get(data[1], r0, 208)).padStart(7)} | ${String(get(data[0], r1, 208)).padStart(7)} | ${String(get(data[1], r0, 224)).padStart(7)} | ${String(get(data[0], r1, 224)).padStart(7)} | ${String(get(data[1], r0, 240)).padStart(7)} | ${String(get(data[0], r1, 240)).padStart(7)}`);
}

// Wide dump of the post-region-list bytes for faction 0 (player) - T1 vs T5
console.log('\n=== Faction 0 (player) bytes +52+4N..+52+4N+340, T1 vs T5 (every u32) ===');
const r0 = data[1].recs[0], r1 = data[0].recs[0];
const base0 = r0.offset + 52 + r0.N * 4;
const base1 = r1.offset + 52 + r1.N * 4;
console.log('  rel | T1 (romeT1)     | T5 (rome10)     | delta');
for (let off = 0; off < 340; off += 4) {
  const v0 = data[1].buf.readUInt32LE(base0 + off);
  const v1 = data[0].buf.readUInt32LE(base1 + off);
  const marker = v0 !== v1 ? ' !' : '';
  console.log(`  ${String(off).padStart(3)} | ${String(v0).padStart(15)} | ${String(v1).padStart(15)} | ${String(v1 - v0).padStart(15)}${marker}`);
}
