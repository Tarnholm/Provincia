// Session 23: cross-validate hash blob structure between rome10 and RoR-T1.
// Both saves are RIS imperial campaign. If the 8B-record array has the same count and structure,
// it's a deterministic-per-campaign structure. If it changes turn-over-turn, it's dynamic state.

const fs = require('fs');

const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const FILES = [
  'save_rome10.sav',
  'save_Autosave   Republic of Rome   Turn 1.sav'
];

function entropy(slice) {
  const freq = new Uint32Array(256);
  for (const b of slice) freq[b]++;
  let H = 0;
  for (const f of freq) {
    if (f === 0) continue;
    const pp = f / slice.length;
    H -= pp * Math.log2(pp);
  }
  return H;
}

// For each save: find the 19KB hash blob region by looking for:
//  - the 239-faction value=3 array header at offset (relative to end of soldier records)
//  - the preceding high-entropy region
// Approach: walk forward from the field-army-units block end, find the all-zero 16-byte stride array
// with N=239 count.

for (const f of FILES) {
  const path = SAVES_DIR + f;
  let buf;
  try { buf = fs.readFileSync(path); } catch (e) { console.log(`(skip ${f}: ${e.message})`); continue; }
  console.log(`\n=== ${f} (${buf.length} bytes) ===`);

  // Search for the 239-faction header pattern: self-pointer + u32=239 + u32=0 + 12-byte zero header + 238 × 16B
  // Pattern signature: at some offset off, [u32 selfPtr=off][u32 239][...]
  let found = null;
  for (let off = 0x1f00000; off < buf.length - 8; off++) {
    if (buf.readUInt32LE(off) === off && buf.readUInt32LE(off + 4) === 239) {
      found = off;
      console.log(`  239-header found at 0x${off.toString(16)}`);
      break;
    }
  }
  if (!found) continue;

  // 12-byte header trailer after off+8 (ef bytes etc.)
  // Then 238 records of 16B all-zero-except-(+0=3)
  // Find where this records array starts
  let recStart = -1;
  for (let pp = found + 8; pp < found + 32; pp++) {
    if (buf.readUInt32LE(pp) === 3) {
      // check next 16B is all zeros
      let ok = true;
      for (let i = 4; i < 16; i++) if (buf[pp + i] !== 0) { ok = false; break; }
      if (ok) {
        // Also verify next record at pp+16 follows the pattern
        if (buf.readUInt32LE(pp + 16) === 3) {
          let ok2 = true;
          for (let i = 4; i < 16; i++) if (buf[pp + 16 + i] !== 0) { ok2 = false; break; }
          if (ok2) {
            recStart = pp;
            break;
          }
        }
      }
    }
  }
  if (recStart < 0) {
    console.log(`  Could not find record array start near header`);
    continue;
  }
  console.log(`  Records array starts at 0x${recStart.toString(16)} (offset from header: ${recStart - found})`);

  // Count records
  let n = 0, p = recStart;
  while (p + 16 <= buf.length) {
    let ok = buf.readUInt32LE(p) === 3;
    if (ok) for (let i = 4; i < 16; i++) if (buf[p+i] !== 0) { ok = false; break; }
    if (!ok) break;
    n++; p += 16;
  }
  console.log(`  Default records: ${n} (expected 238)`);

  // Backward search for previous self-pointer (head of high-entropy zone)
  let hePrev = -1;
  for (let pp = found - 4; pp > found - 0x10000; pp -= 4) {
    if (buf.readUInt32LE(pp) === pp) {
      hePrev = pp;
      break;
    }
  }
  if (hePrev > 0) {
    const dist = found - hePrev;
    console.log(`  Prior self-pointer at 0x${hePrev.toString(16)} (distance ${dist} bytes before 239-header)`);
  }

  // Search for high-entropy region preceding the 239-header
  // Find longest consecutive 256B-chunks with H > 7
  console.log(`  Entropy 256B-chunks 0x${(found - 0x800).toString(16)}..0x${(found+0x100).toString(16)}:`);
  for (let pp = found - 0x800; pp < found + 0x100; pp += 256) {
    const H = entropy(buf.subarray(pp, Math.min(pp + 256, buf.length)));
    const flag = H > 7 ? ' HIGH' : (H > 5 ? ' med' : (H < 2 ? ' LOW' : ''));
    console.log(`    0x${pp.toString(16)}: H=${H.toFixed(2)}${flag}`);
  }
}
