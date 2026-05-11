// dig-diplo10.js — 16-byte stride, not 12.
//
// Record: [u32 X (region_id?)][u32 Y small_int][u32 Z small_int][01 01 01 00].
// Look for X values that map to RTW region IDs.

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
  let arrStart = -1, count = -1;
  for (let i = rlEnd; i < rlEnd + 1024; i++) {
    if (buf[i] === 0x24 && buf[i+1] === 0x39) {
      count = buf.readUInt32LE(i + 2);
      arrStart = i + 6;
      break;
    }
  }
  if (arrStart < 0) return null;
  const records = [];
  for (let r = 0; r < count; r++) {
    const p = arrStart + r * 16;
    if (p + 16 > buf.length) break;
    records.push({
      x: buf.readUInt32LE(p),
      y: buf.readUInt32LE(p + 4),
      z: buf.readUInt32LE(p + 8),
      trailer: buf.slice(p + 12, p + 16).toString('hex')
    });
  }
  return { off, N, count, arrStart, records };
}

function summary(file, label) {
  const buf = fs.readFileSync(file);
  const majors = findMajors(buf);
  console.log(`\n=== ${label}: ${majors.length} majors ===`);
  for (const m of majors) {
    const a = analyzeMajor(buf, m);
    if (!a) continue;
    console.log(`\n  major @ 0x${m.toString(16)} N=${a.N} treasury=${buf.readInt32LE(m)} count=${a.count}`);
    const yhist = {}, zhist = {};
    for (const r of a.records) {
      yhist[r.y] = (yhist[r.y] || 0) + 1;
      zhist[r.z] = (zhist[r.z] || 0) + 1;
    }
    console.log(`    y-hist: ${JSON.stringify(yhist)}`);
    console.log(`    z-hist: ${JSON.stringify(zhist)}`);
    console.log(`    trailers: ${[...new Set(a.records.map(r=>r.trailer))].join(',')}`);
    console.log(`    first 12 records (x,y,z):`);
    for (const r of a.records.slice(0, 12)) console.log(`      x=${r.x} y=${r.y} z=${r.z}`);
  }
}

summary("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav", "rome10");
summary("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav", "RoR-T1");
