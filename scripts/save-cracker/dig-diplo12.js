// dig-diplo12.js — search for a per-faction diplomacy array.
//
// Strategy: search the full file for runs of u32 pairs (faction_id_small,
// state_enum_small) of length ~20. In vanilla imperial_campaign, the playable
// factions are 1..21 (indices in the canonical faction list). The diplomacy
// table would be size 21 records of [fid, state] pairs OR a positional u32[21].
//
// Also search for: the cookie hash documented in session 6 (the diplomacy
// cookie at faction record +28..+31 / "spartan general-34" / etc).

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

// In the major record, search for any u32-aligned array of length 20-25
// where values fit in 0..1000 (small_int) and look "diplomacy-like" (mostly
// one value with a few outliers).
function searchSmallIntArrays(buf, start, end) {
  const hits = [];
  // Look for sequences where u32s in [0..7] of length >= 18.
  for (let p = start; p + 100 < end; p += 4) {
    let n = 0;
    while (p + n*4 + 4 <= end && buf.readUInt32LE(p + n*4) <= 7) n++;
    if (n >= 18 && n <= 30) {
      const vals = [];
      for (let i = 0; i < n; i++) vals.push(buf.readUInt32LE(p + i*4));
      hits.push({ p, n, vals });
    }
  }
  return hits;
}

// Also: u8 arrays of similar shape
function searchSmallU8Arrays(buf, start, end) {
  const hits = [];
  for (let p = start; p + 30 < end; p++) {
    let n = 0;
    while (p + n < end && buf[p + n] <= 7) n++;
    if (n >= 18 && n <= 30) {
      const vals = Array.from(buf.slice(p, p + n));
      // Filter: must have at least 3 distinct values (not all zero)
      const distinct = new Set(vals);
      if (distinct.size < 2) continue;
      hits.push({ p, n, vals });
    }
  }
  return hits;
}

function probe(file, label) {
  const buf = fs.readFileSync(file);
  const majors = findMajors(buf);
  if (!majors.length) { console.log(`${label}: no majors`); return; }
  console.log(`\n=== ${label} ===`);
  // Player record is majors[0]
  const player = majors[0];
  const N = buf.readUInt32LE(player + 48);
  const rlEnd = player + 52 + 4 * N;
  // Search the first 6KB after the region list
  const searchEnd = Math.min(player + 8000, buf.length);
  const u32 = searchSmallIntArrays(buf, rlEnd, searchEnd);
  console.log(`Player @0x${player.toString(16)} N=${N} rlEnd=0x${rlEnd.toString(16)}`);
  console.log(`u32 small-int arrays in player trailing: ${u32.length}`);
  for (const h of u32.slice(0, 6)) {
    console.log(`  @+${h.p-player} len=${h.n} vals=${h.vals.join(',')}`);
  }
  const u8 = searchSmallU8Arrays(buf, rlEnd, searchEnd);
  console.log(`u8 small-int arrays in player trailing: ${u8.length}`);
  for (const h of u8.slice(0, 10)) {
    const distinct = [...new Set(h.vals)];
    console.log(`  @+${h.p-player} len=${h.n} distinct=${distinct.length} vals=${h.vals.join(',')}`);
  }
}

probe("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav", "rome10");
probe("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav", "RoR-T1");
