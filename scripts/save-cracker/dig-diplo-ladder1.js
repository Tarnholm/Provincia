// dig-diplo-ladder1.js
// Locate the 239x239 diplomatic-attitude matrix in each save (save_1..save_9)
// then diff successive saves' matrices to read off enum changes for ladder.
//
// Matrix invariants from session 32:
//   stride = 267 bytes per cell
//   rows*cols = 239*239 = 57121
//   Each cell starts with u32 prev_enum, u32 curr_enum
//   Default (never-met) cell: prev=5 curr=0
//   Cell has u32 0x0a at offset +12 (schema marker)
//   Cell has u32 200 at offset +16 (typical)
//
// Strategy to locate matStart: scan the save for a stretch where many
// consecutive 267-byte cells all start with the "schema fingerprint":
//   bytes +0..+3 are a small u32 (0..255 probably 0..5),
//   bytes +12..+15 == 0a 00 00 00,
//   bytes +16..+19 == c8 00 00 00 or near it.
// Take the first such position with at least 100 consecutive matching
// cells; back up to the first preceding cell that matches the fingerprint.

const fs = require('fs');
const path = require('path');

const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

const STRIDE = 267;
const N = 239;

function loadSave(file) {
  return fs.readFileSync(path.join(SAVES_DIR, file));
}

function isCellLike(buf, off) {
  if (off + STRIDE > buf.length) return false;
  // schema marker at +12 must equal 10 (u32)
  if (buf.readUInt32LE(off + 12) !== 10) return false;
  // +16 is "mostly 200" — accept 100..1000 to be lenient
  const v16 = buf.readUInt32LE(off + 16);
  if (v16 < 50 || v16 > 2000) return false;
  // prev_enum at +0 should be small
  const prev = buf.readUInt32LE(off + 0);
  if (prev > 20) return false;
  const curr = buf.readUInt32LE(off + 4);
  if (curr > 20) return false;
  return true;
}

function findMatStart(buf, hintNear = 0xf8fd2) {
  // Try the hint first
  if (isCellLike(buf, hintNear)) {
    // Walk back: keep stepping STRIDE earlier while still cell-like
    let m = hintNear;
    while (m - STRIDE >= 0 && isCellLike(buf, m - STRIDE)) m -= STRIDE;
    // Walk forward to make sure we have at least 100 consecutive
    let ok = 0;
    for (let i = 0; i < 200; i++) {
      if (isCellLike(buf, m + i * STRIDE)) ok++;
      else break;
    }
    if (ok >= 100) return m;
  }
  // Otherwise sweep ±20KB around the hint
  for (let delta of [0, -1024, 1024, -4096, 4096, -16384, 16384, -65536, 65536]) {
    const base = hintNear + delta;
    if (base < 0 || base >= buf.length) continue;
    if (!isCellLike(buf, base)) continue;
    let m = base;
    while (m - STRIDE >= 0 && isCellLike(buf, m - STRIDE)) m -= STRIDE;
    let ok = 0;
    for (let i = 0; i < 200; i++) {
      if (isCellLike(buf, m + i * STRIDE)) ok++;
      else break;
    }
    if (ok >= 100) return m;
  }
  // Last resort: scan a window
  const w0 = Math.max(0, hintNear - 0x100000);
  const w1 = Math.min(buf.length - STRIDE, hintNear + 0x100000);
  for (let off = w0; off < w1; off += 4) {
    if (!isCellLike(buf, off)) continue;
    // check 50 in a row
    let ok = true;
    for (let i = 1; i < 50; i++) if (!isCellLike(buf, off + i * STRIDE)) { ok = false; break; }
    if (ok) return off;
  }
  return -1;
}

function readCell(buf, base, r, c) {
  const off = base + (r * N + c) * STRIDE;
  // capture key u32s
  const cell = {
    off,
    prev: buf.readUInt32LE(off + 0),
    curr: buf.readUInt32LE(off + 4),
    u8:   buf.readUInt32LE(off + 8),
    u12:  buf.readUInt32LE(off + 12),
    u16:  buf.readUInt32LE(off + 16),
    u20:  buf.readUInt32LE(off + 20),
    u24:  buf.readUInt32LE(off + 24),
    u28:  buf.readUInt32LE(off + 28),
    u32:  buf.readUInt32LE(off + 32),
    bytes: Buffer.from(buf.slice(off, off + STRIDE)),
  };
  return cell;
}

const ROMAN = 0;
const MESS = 156;
const TARAS = 207;

const files = ['save_1.1.sav','save_2.1.sav','save_3.1.sav','save_4.1.sav','save_5.1.sav','save_6.1.sav','save_7.1.sav','save_8.1.sav','save_9.1.sav'];

const results = {};
for (const f of files) {
  console.log('Loading', f);
  const buf = loadSave(f);
  console.log('  size:', buf.length);
  const m = findMatStart(buf, 0xf8fd2);
  console.log('  matStart:', '0x'+m.toString(16));
  if (m < 0) { console.log('  !! could not locate matrix'); continue; }
  // Read key cells
  const r0_156 = readCell(buf, m, ROMAN, MESS);
  const r156_0 = readCell(buf, m, MESS, ROMAN);
  const r0_207 = readCell(buf, m, ROMAN, TARAS);
  const r207_0 = readCell(buf, m, TARAS, ROMAN);
  const r156_207 = readCell(buf, m, MESS, TARAS);
  const r207_156 = readCell(buf, m, TARAS, MESS);
  results[f] = { matStart: m, size: buf.length, buf, cells: { r0_156, r156_0, r0_207, r207_0, r156_207, r207_156 } };
}

console.log('\n--- KEY CELLS (prev,curr,+8,+16,+20,+24,+28,+32) ---');
const cellKeys = ['r0_156','r156_0','r0_207','r207_0','r156_207','r207_156'];
const labels = { r0_156:'[Rom][Mes]', r156_0:'[Mes][Rom]', r0_207:'[Rom][Tar]', r207_0:'[Tar][Rom]', r156_207:'[Mes][Tar]', r207_156:'[Tar][Mes]' };
for (const k of cellKeys) {
  console.log('--- ' + labels[k] + ' ---');
  for (const f of files) {
    const r = results[f];
    if (!r) continue;
    const c = r.cells[k];
    console.log(`  ${f}  prev=${c.prev} curr=${c.curr} +8=${c.u8} +16=${c.u16} +20=${c.u20} +24=${c.u24} +28=${c.u28} +32=${c.u32}`);
  }
}

// Save for next scripts
const tmp = {};
for (const f of files) {
  if (!results[f]) continue;
  tmp[f] = { matStart: results[f].matStart, size: results[f].size };
}
fs.writeFileSync(path.join(__dirname,'diplo-ladder-matstarts.json'), JSON.stringify(tmp,null,2));
console.log('\nWrote diplo-ladder-matstarts.json');
