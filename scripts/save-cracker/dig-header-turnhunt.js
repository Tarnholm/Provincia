// dig-header-turnhunt.js
// 0x00-0x500 has NO per-turn variation. So:
//  (1) Confirm player-faction id is NOT in 0x00-0x500 (compare known players).
//  (2) Find where the TURN counter actually lives: scan the WHOLE file for a
//      u32 (and u16) that is exactly {0,1,2,3,4,5,6,7} across t0,t1..t7 at the
//      SAME offset (monotonic +1). Restrict to offsets present in all files.
//  (3) Find the YEAR: a value that decreases by a fixed step (BC counts down).

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
function load(name) { return fs.readFileSync(path.join(S, name)); }

// ── PART 1: player-faction discriminator in header ──
// Known players: t0=julii(0)?, Spain=spain(18), Macedon=macedon(12),
// Seleucid=seleucid(5), Carthage=carthage(6), Antigonid=antigonid (RIS order differs).
// Across these the player faction is DIFFERENT, so any header byte == playerId
// must differ across them. We already saw 0x00-0x500 only varies in uuid/hash/
// bitmask zones. Re-list the few non-shifted varying offsets explicitly.
console.log('=== PART 1: header bytes that genuinely differ by CAMPAIGN (not just faction-array shift) ===');
console.log('(The faction-config array shift is a red herring; only 0x04, 0x28-0x33, bitmask zone are real.)');
console.log('Conclusion check: is there any 0x00-0x60 byte that uniquely tracks player faction? -> see u32 table previous run; only 0x04/0x28/0x2c/0x30 vary and they are hashes/timestamps, NOT small faction indices.');

// ── PART 2: turn counter hunt across t0..t7 ──
const turnSeq = [
  ['t0', 0, 'save_t0.sav'],
  ['t1', 1, 'save_t1.sav'],
  ['t2', 2, 'save_t2.sav'],
  ['t3', 3, 'save_t3.sav'],
  ['t4', 4, 'save_t4.sav'],
  ['t5', 5, 'save_t5.sav'],
  ['t6', 6, 'save_t6.sav'],
  ['t7', 7, 'save_t7.sav'],
];
const tb = turnSeq.map(([tag, turn, fn]) => ({ tag, turn, buf: load(fn) }));
const minLen = Math.min(...tb.map(b => b.buf.length));
console.log('\n=== PART 2: scanning 0..0x20000 for u32 == turn index (0..7) at same offset ===');
console.log('minLen across t0..t7 = 0x' + minLen.toString(16));

// The turn numbers are 0,1,2,3,4,5,6,7 by save filename. But t0..t7 are
// successive TURNS; the engine's turn counter might start at 1 not 0, or count
// 2-per (start/end). We search for ANY linear relation v = a*turn + b with the
// SAME a,b at one offset across all 8 saves, integer a in [1,4], any b.
const HUNT_LIMIT = Math.min(minLen, 0x40000); // header + early body
const candidates = [];
for (let off = 0; off + 4 <= HUNT_LIMIT; off++) {
  const vals = tb.map(b => b.buf.readUInt32LE(off));
  // must be strictly increasing or strictly decreasing
  let inc = true, dec = true;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] <= vals[i - 1]) inc = false;
    if (vals[i] >= vals[i - 1]) dec = false;
  }
  if (!inc && !dec) continue;
  // check constant step
  const step = vals[1] - vals[0];
  if (step === 0) continue;
  if (Math.abs(step) > 10) continue; // turn step should be tiny (1 or 2)
  let constStep = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] - vals[i - 1] !== step) { constStep = false; break; }
  if (!constStep) continue;
  // reject huge base values (likely pointers) unless step is exactly 1 and base small
  if (Math.abs(vals[0]) > 100000 && Math.abs(step) !== 1) continue;
  candidates.push({ off, step, vals });
}
console.log('Found ' + candidates.length + ' monotonic constant-step u32 offsets:');
for (const c of candidates.slice(0, 80)) {
  console.log('  0x' + c.off.toString(16).padStart(6, '0') + ' step=' + c.step + '  vals=[' + c.vals.join(',') + ']');
}
if (candidates.length > 80) console.log('  ... (' + (candidates.length - 80) + ' more)');

// Same for u16
console.log('\n=== u16 monotonic constant-step in 0..0x40000 ===');
const c16 = [];
for (let off = 0; off + 2 <= HUNT_LIMIT; off++) {
  const vals = tb.map(b => b.buf.readUInt16LE(off));
  let inc = true, dec = true;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] <= vals[i - 1]) inc = false;
    if (vals[i] >= vals[i - 1]) dec = false;
  }
  if (!inc && !dec) continue;
  const step = vals[1] - vals[0];
  if (step === 0 || Math.abs(step) > 10) continue;
  let constStep = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] - vals[i - 1] !== step) { constStep = false; break; }
  if (!constStep) continue;
  c16.push({ off, step, vals });
}
console.log('Found ' + c16.length + ' u16 monotonic offsets:');
for (const c of c16.slice(0, 60)) {
  console.log('  0x' + c.off.toString(16).padStart(6, '0') + ' step=' + c.step + '  vals=[' + c.vals.join(',') + ']');
}
if (c16.length > 60) console.log('  ... (' + (c16.length - 60) + ' more)');
