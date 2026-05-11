// Count character records in each Macedon save to know how many characters
// the player has. We can use a known pattern from session 4 (-16 and -4 self-
// pointers around character X,Y u32 coordinates), or simpler: count unique
// instances of a distinctive character record signature.
//
// Approach (cheap): count occurrences of the pattern that distinguishes a
// character. Then see how that count evolves T1->T40.

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
function load(label) {
  const v = byLabel.get(label);
  if (!v) return null;
  return fs.readFileSync(path.join(dir, v.file));
}

// Character signature from session 4: at character X-coord position, there's a
// nested section header at -16/-4 (double self-pointer). Count those:
function countCharacters(buf) {
  let count = 0;
  const N = buf.length;
  for (let i = 0; i + 24 < N; i++) {
    if (buf.readUInt32LE(i) !== i) continue;
    if (buf.readUInt32LE(i + 12) !== i + 12) continue;
    const x = buf.readUInt32LE(i + 16);
    const y = buf.readUInt32LE(i + 20);
    if (x === 0 || y === 0) continue;
    if (x > 1024 || y > 1024) continue;
    count++;
  }
  return count;
}

// Use session-4's pattern. But not strict — just count anything matching.
// Run on T1S, T2S, ..., T40S
const data = [];
for (let t = 1; t <= 99; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const c = countCharacters(buf);
  data.push({ t, c, size: buf.length });
  if (t <= 20 || t % 5 === 0) console.log(`T${t.toString().padStart(2)}S size=${buf.length} chars=${c}`);
}
