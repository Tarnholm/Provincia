// Save-file inventory: chart the whole file in 4-KB blocks, classify
// each block by content type, and identify the largest unmapped zones.

const fs = require('fs');
const path = require('path');

const SAVE = 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav';
const A = fs.readFileSync(SAVE);
console.log('File size:', A.length, '(0x' + A.length.toString(16) + ')');

// Known landmark zones (from prior session findings)
const KNOWN_ZONES = [
  // Header / HST
  { from: 0x0000, to: 0x4400, label: 'header + HST + path strings + lua counter names' },

  // Body section grammar zone
  { from: 0x4400, to: 0x84000, label: 'body section grammar (early)' },

  // Scripted events
  { from: 0x84000, to: 0xa9000, label: 'scripted events (historic, olympics)' },

  // Tile-attribute static map (session 99)
  { from: 0x800000, to: 0x1180000, label: 'tile-attribute static map (session 99 confirmed)' },

  // Settlement zone (session ~30)
  { from: 0x1180000, to: 0x14e0000, label: 'settlement zone (buildings, regions)' },

  // Character records (session 110)
  { from: 0x14e0000, to: 0x1540000, label: 'character/position records (session 110)' },

  // Major-faction records (session 5 + 109)
  { from: 0x1540000, to: 0x17d0000, label: 'major-faction records (23 majors, session 5)' },

  // NPC ff-records — exploration grids
  { from: 0x17d0000, to: 0x2200000, label: 'NPC ff-records / exploration grids (session 108)' },

  // Tail (less explored)
  { from: 0x2200000, to: 0x2300000, label: 'late tail — long-tail records + section pointer tables' },

  { from: 0x2300000, to: A.length, label: 'final tail' },
];

function findZone(off) {
  for (const z of KNOWN_ZONES) {
    if (off >= z.from && off < z.to) return z.label;
  }
  return 'UNZONED';
}

// Classify each 4-KB block
const BLOCK_SIZE = 0x1000;
const blocks = [];
for (let i = 0; i < A.length; i += BLOCK_SIZE) {
  const end = Math.min(i + BLOCK_SIZE, A.length);
  const slice = A.subarray(i, end);
  const len = end - i;

  // Counts
  let zeros = 0, ffs = 0, ascii = 0, nonAscii = 0;
  for (const b of slice) {
    if (b === 0) zeros++;
    else if (b === 0xff) ffs++;
    else if (b >= 0x20 && b < 0x7f) ascii++;
    else nonAscii++;
  }
  // Has section-grammar header (u32 selfPtr == position) — quick check first 16 bytes
  let hasSelfPtr = false;
  if (slice.length >= 4 && A.readUInt32LE(i) === i) hasSelfPtr = true;
  // Has ASCII strings of length ≥4?
  let asciiRuns = 0;
  let curRun = 0;
  for (const b of slice) {
    if (b >= 0x20 && b < 0x7f) { curRun++; if (curRun === 4) asciiRuns++; }
    else curRun = 0;
  }

  // Classification:
  let cls;
  if (zeros / len >= 0.95) cls = 'ZEROS';
  else if (ffs / len >= 0.95) cls = 'FFs';
  else if ((zeros + ffs) / len >= 0.95) cls = 'PAD';
  else if (asciiRuns >= 4) cls = 'ASCII-rich';
  else if (hasSelfPtr) cls = 'SECTION-grammar';
  else cls = 'DATA';

  blocks.push({ start: i, end, cls, zone: findZone(i), zeroPct: zeros / len, asciiRuns });
}

// Compute coalesced classified zones
console.log('\n=== Coalesced classification (4-KB blocks merged where same cls + zone) ===');
let curStart = 0;
let curCls = blocks[0].cls;
let curZone = blocks[0].zone;
const merged = [];
for (let k = 1; k <= blocks.length; k++) {
  const b = blocks[k];
  if (k === blocks.length || b.cls !== curCls || b.zone !== curZone) {
    merged.push({ start: curStart, end: blocks[k - 1].end, cls: curCls, zone: curZone });
    if (k < blocks.length) {
      curStart = b.start;
      curCls = b.cls;
      curZone = b.zone;
    }
  }
}

for (const m of merged) {
  const size = m.end - m.start;
  console.log('  0x' + m.start.toString(16).padStart(8, '0') +
              '..0x' + m.end.toString(16).padStart(8, '0') +
              '  size=' + (size / 1024).toFixed(1).padStart(7) + ' KB' +
              '  cls=' + m.cls.padEnd(16) +
              '  zone="' + m.zone + '"');
}

// Top-10 LARGEST contiguous "DATA" or "ASCII-rich" zones outside known landmarks
console.log('\n=== Largest UNZONED data blocks (potential cracking targets) ===');
const targets = merged
  .filter(m => m.zone === 'UNZONED' && (m.cls === 'DATA' || m.cls === 'ASCII-rich' || m.cls === 'SECTION-grammar'))
  .sort((a, b) => (b.end - b.start) - (a.end - a.start))
  .slice(0, 10);
for (const t of targets) {
  console.log('  0x' + t.start.toString(16).padStart(8, '0') +
              '..0x' + t.end.toString(16).padStart(8, '0') +
              '  size=' + ((t.end - t.start) / 1024).toFixed(1) + ' KB  ' + t.cls);
}

// Output a coarse summary by KNOWN_ZONE
console.log('\n=== Summary by known zone ===');
const zoneTotals = new Map();
for (const m of merged) {
  const k = m.zone;
  zoneTotals.set(k, (zoneTotals.get(k) || 0) + (m.end - m.start));
}
const sortedZones = Array.from(zoneTotals.entries()).sort((a, b) => b[1] - a[1]);
for (const [zone, total] of sortedZones) {
  console.log('  ' + (total / 1024 / 1024).toFixed(2).padStart(6) + ' MB  ' + zone);
}

// Identify the largest pure-DATA blocks (no ASCII, no section headers,
// not pure zeros/FFs) — these are dense binary regions that might be
// under-decoded.
console.log('\n=== Top-5 largest pure-DATA blocks (no ASCII, no zeros) ===');
const dataOnly = merged.filter(m => m.cls === 'DATA').sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 5);
for (const t of dataOnly) {
  console.log('  0x' + t.start.toString(16).padStart(8, '0') +
              '..0x' + t.end.toString(16).padStart(8, '0') +
              '  size=' + ((t.end - t.start) / 1024).toFixed(1) + ' KB  zone="' + t.zone + '"');
}
