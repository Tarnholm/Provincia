// In Macedon T97 (late campaign), find sections that contain records with:
// - turn-like value (small, 1..200)
// - X, Y tile coords
// - faction IDs (small, 0..30)
// - casualty counts (medium)
//
// FAMOUS_BATTLE_SITE_MANAGER section: look for a list of (X, Y) battle locations.

const fs = require('fs');

function findBattleSites(filePath) {
  const buf = fs.readFileSync(filePath);
  console.log('\n=== ' + filePath.split(/[\/\\]/).pop() + ' ===');

  // Look in body for sequences of (X, Y) pairs where X∈[1..1020], Y∈[1..700]
  // and they cluster at fixed strides

  // First let's find body root
  const hstStart = buf.indexOf(Buffer.from('WORLD_MAP\0'));
  let p = hstStart;
  while (p < hstStart + 4096) {
    const sStart = p;
    while (p < buf.length && buf[p] !== 0) p++;
    if (p >= buf.length) break;
    const name = buf.slice(sStart, p).toString('utf8');
    p++;
    if (p + 4 > buf.length) break;
    const v = buf.readUInt32LE(p);
    p += 4;
    if (!/^[A-Z_]/.test(name) || v > 100) { p -= 4; break; }
  }
  const hstEnd = p;
  console.log('HST ends at 0x' + hstEnd.toString(16));

  // Find sections from hstEnd onwards
  let q = hstEnd;
  const sections = [];
  while (q + 8 <= buf.length) {
    let found = false;
    for (let scan = 0; scan < 100000 && q + scan + 8 <= buf.length; scan++) {
      const c = q + scan;
      const sp = buf.readUInt32LE(c);
      if (sp !== c) continue;
      const sz = buf.readUInt32LE(c + 4);
      if (sz < 8 || c + sz > buf.length) continue;
      sections.push({ off: c, sz });
      q = c + sz;
      found = true;
      break;
    }
    if (!found) break;
  }
  console.log('total sections walked:', sections.length);

  // For each section, check for clusters of (X, Y) pairs at common strides
  // Each FAMOUS_BATTLE record might be ~24-32 bytes
  for (const stride of [16, 20, 24, 28, 32, 36, 40, 48]) {
    let bestSection = null, bestHits = 0;
    for (const s of sections) {
      if (s.sz < 100) continue;
      let hits = 0;
      for (let i = s.off + 8; i + 8 < s.off + s.sz; i += stride) {
        const x = buf.readUInt32LE(i);
        const y = buf.readUInt32LE(i + 4);
        if (x >= 1 && x <= 1020 && y >= 1 && y <= 700) hits++;
      }
      if (hits > bestHits) { bestHits = hits; bestSection = s; }
    }
    if (bestHits > 0) {
      console.log(' stride=' + stride, 'best section: 0x' + bestSection.off.toString(16), 'size:', bestSection.sz, 'XY-hit count:', bestHits);
    }
  }

  // Also scan the whole file for arrays of (X, Y) pairs with stride 16/24/32
  // where both X and Y are in valid range
  console.log('Whole-file (X,Y) cluster scan at stride 24:');
  let inRun = false, runStart = -1, runLen = 0;
  const stride = 24;
  const runs = [];
  for (let i = 0; i + 8 < buf.length; i += 4) {
    const x = buf.readUInt32LE(i);
    const y = buf.readUInt32LE(i + 4);
    const valid = x >= 1 && x <= 1020 && y >= 1 && y <= 700;
    if (valid) {
      if (!inRun) { inRun = true; runStart = i; runLen = 1; }
      else runLen++;
    } else {
      if (inRun && runLen >= 5) runs.push({ start: runStart, len: runLen });
      inRun = false;
    }
  }
  runs.sort((a,b) => b.len - a.len);
  console.log('top 10 (X,Y) runs:');
  for (const r of runs.slice(0, 10)) {
    console.log(' 0x' + r.start.toString(16), 'len:', r.len);
  }
}

findBattleSites('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');
findBattleSites('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
