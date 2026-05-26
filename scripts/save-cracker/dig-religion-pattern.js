// Refined religion percentage search:
// Look for byte sequences that have MIXED values (not 0/0/0/100/0/0 dominant-only),
// summing to ~95-105. These are real religion breakdowns vs. dominant-religion settlements.

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVE = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

// Look in a WIDE range — all settlement records likely live between 0x10000 and 0x1f000
const SCAN_START = 0x10000;
const SCAN_END = 0x20000;

console.log('Scanning for 6-7 byte religion patterns (mixed values, sum 95-105)...\n');

// Try 6-byte (with sum 95-105 and at least 3 non-zero values)
const candidates = [];
for (let off = SCAN_START; off < SCAN_END; off++) {
  for (const len of [6, 7]) {
    let sum = 0;
    let nonZero = 0;
    let validBytes = true;
    for (let i = 0; i < len; i++) {
      const b = SAVE[off + i];
      if (b > 100) { validBytes = false; break; }
      sum += b;
      if (b > 0) nonZero++;
    }
    if (!validBytes) continue;
    if (sum < 95 || sum > 105) continue;
    if (nonZero < 3) continue;
    // Skip if all values are 0 except one (dominant — uninteresting)
    candidates.push({ off, len, sum, bytes: Array.from(SAVE.slice(off, off + len)) });
  }
}

console.log('Found ' + candidates.length + ' mixed-religion candidates');

// Group by offset proximity (within 256 bytes = same settlement)
candidates.sort((a, b) => a.off - b.off);
let lastOff = -1000;
let cluster = [];
const clusters = [];
for (const c of candidates) {
  if (c.off - lastOff > 256 && cluster.length > 0) {
    clusters.push(cluster);
    cluster = [];
  }
  cluster.push(c);
  lastOff = c.off;
}
if (cluster.length > 0) clusters.push(cluster);

console.log('Settlements clustered: ' + clusters.length);
for (let i = 0; i < Math.min(clusters.length, 15); i++) {
  console.log('\nSettlement cluster ' + (i + 1) + ' (' + clusters[i].length + ' candidates, range 0x' +
    clusters[i][0].off.toString(16) + ' to 0x' + clusters[i][clusters[i].length-1].off.toString(16) + '):');
  for (const c of clusters[i].slice(0, 6)) {
    console.log('  0x' + c.off.toString(16) + ' len=' + c.len + ' sum=' + c.sum + ' [' + c.bytes.join(',') + ']');
  }
}

// Approach 2: find a sequence of NEARBY 6-byte windows with the EXACT same starting
// offset relative to settlement boundaries — those are the real religion offsets.

// Approach 3: look for u8[6] = [x, y, z, w, v, u] where these correspond to known
// Alexander religion values. In Alexander, religions are typically: greek, eastern,
// egyptian, carthaginian, barbarian — 5-6 religions.

// Find consistent OFFSET FROM SETTLEMENT NAME within ranges where settlement records
// likely live. The Alexander religions are listed in descr_religions.txt — let me load
// that to understand the count.

const ALEX_RELIGIONS_PATH = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\alexander\\data\\descr_religions.txt';
const fs2 = require('fs');
if (fs2.existsSync(ALEX_RELIGIONS_PATH)) {
  const r = fs2.readFileSync(ALEX_RELIGIONS_PATH, 'utf-8');
  const religions = (r.match(/religion\s+\w+/g) || []).map(s => s.split(/\s+/)[1]);
  console.log('\nAlexander religions: ' + religions.length);
  for (const x of religions) console.log('  ' + x);
}
