// Session 21: Battle log probe via cross-turn diff.
// Strategy: identify pairs of "complete" saves across consecutive turns in the
// Macedon calibration archive (size ~1MB+, distinct turn labels). Diff bytes
// to find regions that grow by 50-100 bytes per turn (battle-log entries).

const fs = require('fs');
const path = require('path');

const dir = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const all = fs.readdirSync(dir).sort();

// Group by turn label, keep the largest file per label (the complete save).
const byLabel = new Map();
for (const f of all) {
  const m = f.match(/^(\d{4})_save_(.+)\.sav$/);
  if (!m) continue;
  const idx = parseInt(m[1], 10);
  const label = m[2];
  const size = fs.statSync(path.join(dir, f)).size;
  const prev = byLabel.get(label);
  if (!prev || size > prev.size) {
    byLabel.set(label, { file: f, size, idx });
  }
}

const labels = Array.from(byLabel.entries()).sort((a, b) => a[1].idx - b[1].idx);
console.log(`Distinct turn labels: ${labels.length}`);
for (const [label, info] of labels) {
  console.log(`  ${info.idx.toString().padStart(4)} ${info.size.toString().padStart(10)} ${label}`);
}
