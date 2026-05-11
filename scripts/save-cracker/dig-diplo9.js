// dig-diplo9.js — analyze the 12-byte-stride array we found in dig-diplo8.
//
// Pattern (after the +52+4N region list): 0x10 zeros + 0x39 marker + u32 count + N * 12 bytes.
// Each 12-byte record: [u32 X][u32 Y][01 01 01 00].
//
// Hypothesis: X = region_id (or faction_id), Y = state enum, byte trailer = padding.

const fs = require("fs");

function findMajors(buf) {
  const out = [];
  for (let i = 0x3000; i + 56 < buf.length; i += 4) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    out.push(i);
  }
  return out.sort((a, b) => a - b);
}

function analyzeMajor(buf, off) {
  const N = buf.readUInt32LE(off + 48);
  const rlEnd = off + 52 + 4 * N;
  // Scan forward from rlEnd looking for the count + 12-byte stride pattern.
  // The data we saw has a header structure: walk a bit and find the count.
  // From dump:
  //   rome10 player: array starts at relative +340 (count u32 = 0x22 at +336),
  //                  records at +340 in 12-byte chunks.
  // The marker `24 39` at offset 0x130/0x150 (depending on save) before count.
  // Use the 0x24 0x39 marker as anchor.

  // Find the first `01 01 01 00` after rlEnd as a probe
  let arrStart = -1, count = -1;
  for (let i = rlEnd; i < rlEnd + 1024; i++) {
    if (buf[i] === 0x24 && buf[i+1] === 0x39) {
      // Count is at i+2..+5
      count = buf.readUInt32LE(i + 2);
      arrStart = i + 6;
      break;
    }
  }
  if (arrStart < 0) return null;

  const records = [];
  for (let r = 0; r < count; r++) {
    const p = arrStart + r * 12;
    if (p + 12 > buf.length) break;
    const x = buf.readUInt32LE(p);
    const y = buf.readUInt32LE(p + 4);
    const trailer = buf.slice(p + 8, p + 12).toString('hex');
    records.push({ x, y, trailer });
  }
  return { off, N, count, arrStart, records };
}

function summary(file) {
  const buf = fs.readFileSync(file);
  const majors = findMajors(buf);
  console.log(`\n=== ${file} ===`);
  console.log(`majors: ${majors.length}`);
  for (const m of majors) {
    const a = analyzeMajor(buf, m);
    if (!a) { console.log(`  0x${m.toString(16)} N=${buf.readUInt32LE(m+48)} (no array found)`); continue; }
    const ys = a.records.map(r => r.y);
    const yhist = {};
    for (const y of ys) yhist[y] = (yhist[y] || 0) + 1;
    console.log(`  0x${m.toString(16)} N=${a.N} treasury=${buf.readInt32LE(m)} count=${a.count}`);
    console.log(`    y-histogram: ${JSON.stringify(yhist)}`);
    console.log(`    first 8 records: ${a.records.slice(0,8).map(r => `${r.x}/${r.y}`).join(' ')}`);
  }
}

summary("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav");
summary("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav");
