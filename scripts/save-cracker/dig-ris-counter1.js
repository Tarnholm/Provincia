// Session 22: Find the RIS imperial equivalent of the Alex per-faction event
// counter (Alex schema: tag `21` at +(92+4N+16), counter A at +(92+4N+20)).
//
// We have 2 RIS imperial saves: rome10 (T~5 SPQR) + Republic of Rome T1 (T1).
// Both have 23 major factions per session 5.
//
// Strategy:
// 1. For each save, locate the 23 major-faction records (taw discriminator +44=6).
// 2. For each record, dump bytes +52+4N (after region list) onwards for ~100 bytes.
// 3. Look for any short constant tag followed by an increasing/varying small u32.
// 4. Compare T1 vs T5 to see what changed.

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

for (const { label, path } of SAVES) {
  const buf = fs.readFileSync(path);
  console.log(`\n=== ${label}: ${buf.length} bytes ===`);
  const recs = findMajorFactionRecords(buf);
  console.log(`Found ${recs.length} major-faction records`);

  // For each record, print key fields at +52+4N and +92+4N
  for (let i = 0; i < Math.min(recs.length, 25); i++) {
    const r = recs[i];
    const N = r.N;
    const baseEnd = r.offset + 52 + N * 4;
    const treasureDup = r.offset + 92 + N * 4;

    // Print bytes from +52+4N to +52+4N+80
    const slice = buf.subarray(baseEnd, baseEnd + 80);
    // Hex format with markers
    const hex = [];
    for (let j = 0; j < slice.length; j += 4) {
      hex.push(slice.readUInt32LE(j).toString().padStart(10));
    }
    console.log(`  [${i.toString().padStart(2)}] off=0x${r.offset.toString(16)} N=${N} treas=${r.treasury}`);
    console.log(`       +52+4N..+132+4N (20 u32 values): ${hex.join(' ')}`);
  }
}
