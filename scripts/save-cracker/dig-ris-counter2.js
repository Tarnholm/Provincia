// Session 22: RIS counter probe #2.
// The bytes at +52+4N..+132+4N are IDENTICAL between rome10 and romeT1 except
// for the final u32 (probably an offset to the next record).
//
// But rome10 is T5 and romeT1 is T1. The event counter (if it exists) should differ.
// Let me check a much wider window — bytes +132+4N to +400+4N.

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

// Load both saves
const data = SAVES.map(s => {
  const buf = fs.readFileSync(s.path);
  const recs = findMajorFactionRecords(buf);
  return { label: s.label, buf, recs };
});

// For each pair of corresponding factions, diff the bytes at +52+4N..+1000+4N
console.log('=== Per-faction byte diff from offset +52+4N (between T1 and T5) ===');
const ris1 = data[0], ris0 = data[1];

for (let i = 0; i < 23; i++) {
  const r1 = ris0.recs[i]; const r2 = ris1.recs[i];
  if (r1.N !== r2.N) {
    console.log(`  Faction ${i}: N differs (T1=${r1.N}, T5=${r2.N}), skipping`);
    continue;
  }
  const N = r1.N;
  // Diff bytes from +52+4N onwards. Find where the records "end" — use the next record's offset.
  const end1 = i + 1 < 23 ? ris0.recs[i+1].offset - r1.offset : 4096;
  const end2 = i + 1 < 23 ? ris1.recs[i+1].offset - r2.offset : 4096;
  const minLen = Math.min(end1, end2);
  let diffs = [];
  for (let off = 52 + 4*N; off + 4 <= minLen; off += 4) {
    const v1 = ris0.buf.readUInt32LE(r1.offset + off);
    const v2 = ris1.buf.readUInt32LE(r2.offset + off);
    if (v1 !== v2) diffs.push({ off, v1, v2, delta: v2 - v1 });
  }
  if (diffs.length === 0) continue;
  // Skip the trailing "next-record-offset" diff
  console.log(`  Faction ${i} (treas T1=${r1.treasury} T5=${r2.treasury}, N=${N}, end1=${end1}, end2=${end2}):`);
  for (const d of diffs.slice(0, 12)) {
    const rel = d.off - (52 + 4*N);
    console.log(`    +52+4N+${rel} (=+${d.off}): T1=${d.v1} → T5=${d.v2} delta=${d.delta}`);
  }
  if (diffs.length > 12) console.log(`    ...and ${diffs.length - 12} more diffs`);
}
