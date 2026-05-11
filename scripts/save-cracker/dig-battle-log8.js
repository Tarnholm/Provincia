// Session 21: Diff consecutive Macedon turn-pairs (StartT / EndT) to isolate
// the small region that grows when an autoresolved battle happens during
// the AI rotation.
//
// Strategy: take the 207-label catalog, identify successive turn-Start saves
// (T_N Start → T_{N+1} Start spans one full turn including all AI battles).
// Then byte-diff them and look for *appearing* records (NEW non-zero bytes
// in a region that was previously zero or different).

const fs = require('fs');
const path = require('path');

const dir = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const all = fs.readdirSync(dir).sort();
const byLabel = new Map();
for (const f of all) {
  const m = f.match(/^(\d{4})_save_(.+)\.sav$/);
  if (!m) continue;
  const size = fs.statSync(path.join(dir, f)).size;
  const prev = byLabel.get(m[2]);
  if (!prev || size > prev.size) byLabel.set(m[2], { file: f, size, idx: parseInt(m[1], 10) });
}

// Extract "Turn N Start" pairs.
function getTurnStartSave(n) {
  const label = `Autosave   Macedon   Turn ${n} Start`;
  return byLabel.get(label);
}
function getTurnEndSave(n) {
  const label = `Autosave   Macedon   Turn ${n} End`;
  return byLabel.get(label);
}

// Diff two buffers, return list of {offset, len} of contiguous diff regions.
function diffRegions(a, b, minRun = 1, maxRun = 4096) {
  const len = Math.min(a.length, b.length);
  const regions = [];
  let curStart = -1;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      if (curStart < 0) curStart = i;
    } else {
      if (curStart >= 0 && i - curStart >= minRun) {
        regions.push({ offset: curStart, len: i - curStart });
        curStart = -1;
      } else if (curStart >= 0) {
        curStart = -1;
      }
    }
  }
  if (curStart >= 0) regions.push({ offset: curStart, len: len - curStart });
  return regions;
}

// Look at two clean adjacent turn-Start pairs.
const pairs = [
  // Early game (very few battles)
  [getTurnStartSave(3), getTurnStartSave(4)],
  // Middle (some battles)
  [getTurnStartSave(8), getTurnStartSave(9)],
  // Late game (many battles)
  [getTurnStartSave(80), getTurnStartSave(81)],
  // Turn-start → turn-end of SAME turn (player only — should have 0 battles
  // unless player attacked)
  [getTurnStartSave(86), getTurnEndSave(86)],
];

for (const [a, b] of pairs) {
  if (!a || !b) { console.log(`Missing save for one of the pair`); continue; }
  const A = fs.readFileSync(path.join(dir, a.file));
  const B = fs.readFileSync(path.join(dir, b.file));
  const regs = diffRegions(A, B, 1, 4096);
  const totalDiffBytes = regs.reduce((s, r) => s + r.len, 0);
  console.log(`\n${a.file.slice(5, 60)} (${A.length}) vs ${b.file.slice(5, 60)} (${B.length})`);
  console.log(`  ${regs.length} contiguous diff regions, total ${totalDiffBytes} bytes`);
  // Show largest regions first (likely big sections that changed wholesale)
  // and smallest regions next (small atomic changes — typical of battle log writes).
  regs.sort((x, y) => x.offset - y.offset);
  // Find region runs that are 30-200 bytes (likely battle log entry size)
  const medium = regs.filter(r => r.len >= 30 && r.len <= 200);
  console.log(`  ${medium.length} medium (30-200B) diff regions`);
  // Print first 15 of medium-sized:
  for (const r of medium.slice(0, 15)) {
    console.log(`    0x${r.offset.toString(16).padStart(8,'0')} len=${r.len}`);
  }
}
