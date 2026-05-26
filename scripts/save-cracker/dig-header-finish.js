// Finish the header decode:
//   1. Zone 0x60-0xf0 (between post-name constants and faction-config array)
//   2. Zone 0xde0-0x43f8 (between section registry and mod path) — ~13 KB
//   3. The 4-byte value at 0x43f8 before the path length prefix
//
// Strategy:
//   - Diff multiple saves to find what varies per session/save vs constants
//   - Identify embedded UUIDs (8-byte UUID-like patterns)
//   - Find structural markers (TAW self-pointers: u32 value == its own offset)

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const saves = [
  { name: 'PRE',       path: path.join(BASE_R, 'save_arretium pre retrained..sav') },
  { name: 'QUEUE',     path: path.join(BASE_R, 'save_arretium queued retrain.sav') },
  { name: 'POST',      path: path.join(BASE_R, 'save_arretium retrained turn 2.sav') },
  { name: 'T2-queue',  path: path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav') },
  { name: 'T3',        path: path.join(BASE_R, 'save_arretium turn 3.sav') },
  { name: 'T4',        path: path.join(BASE_R, 'save_arretium turn 4.sav') },
  { name: 'Spain-T1',  path: path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav') },
  { name: 'Alex-T1',   path: path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav') },
];

const bufs = saves.map(s => ({ name: s.name, buf: fs.readFileSync(s.path) }));

// ── PART 1: 0x60-0xf0 zone ──
// Per the agent, the "0xf0" anchor is wrong — the marker `12 34 de 0a` can appear
// earlier (at 0xba in Spain, 0xaa in Macedon). Find the FIRST marker per save.
console.log('=== PART 1: First 12 34 de 0a marker per save ===');
const marker = Buffer.from([0x12, 0x34, 0xde, 0x0a]);
for (const b of bufs) {
  const first = b.buf.indexOf(marker);
  // Read campaign name length to compute name_end
  const nameLen = b.buf.readUInt16LE(0x3a);
  const nameEnd = 0x3c + nameLen * 2;
  // Distance from name_end to first marker
  const dx = first - nameEnd;
  console.log('  ' + b.name.padEnd(12) + ' first marker @0x' + first.toString(16) +
    '  (name_end=0x' + nameEnd.toString(16) + ', delta from name_end = ' + dx + ')');
}

// ── PART 2: Bytes name_end..first_marker ──
// What's in the gap between post-name constants and the first faction config record?
console.log('\n=== PART 2: Bytes from name_end to first faction marker ===');
for (const b of bufs.slice(0, 3).concat([bufs[6], bufs[7]])) {
  const nameLen = b.buf.readUInt16LE(0x3a);
  const nameEnd = 0x3c + nameLen * 2;
  const first = b.buf.indexOf(marker);
  const gap = first - nameEnd;
  console.log('\n--- ' + b.name + ' (gap=' + gap + ' bytes) ---');
  for (let off = nameEnd; off < first; off += 16) {
    const len = Math.min(16, first - off);
    const hex = Array.from(b.buf.slice(off, off + len)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(b.buf.slice(off, off + len)).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log('  0x' + off.toString(16) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
  }
}

// ── PART 3: 0xde0-0x43f8 (after section registry, before mod path) ──
// Find strings, look for repeating patterns, TAW self-pointers
console.log('\n\n=== PART 3: 0xde0-0x4400 structure (sample from PRE save) ===');
const pre = bufs[0].buf;
// Find TAW self-pointers (u32 at p == p)
console.log('TAW self-pointers (u32 value == offset):');
const tawPtrs = [];
for (let p = 0xde0; p < 0x4400; p += 4) {
  if (pre.readUInt32LE(p) === p) tawPtrs.push(p);
}
console.log('  Found ' + tawPtrs.length + ': ' + tawPtrs.map(p => '0x' + p.toString(16)).join(', '));

// Find embedded pstr16 strings
function readPstr16UTF16(buf, off) {
  if (off + 2 > buf.length) return null;
  const chars = buf.readUInt16LE(off);
  if (chars < 3 || chars > 200) return null;
  if (off + 2 + chars * 2 > buf.length) return null;
  let s = '';
  for (let i = 0; i < chars; i++) {
    const lo = buf[off + 2 + i * 2], hi = buf[off + 2 + i * 2 + 1];
    if (hi !== 0 || lo < 0x20 || lo > 0x7e) return null;
    s += String.fromCharCode(lo);
  }
  return { str: s, totalLen: 2 + chars * 2 };
}
function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 3 || lenP1 > 200) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

console.log('\nEmbedded strings in 0xde0..0x4400:');
let p = 0xde0;
const strings = [];
while (p < 0x4400) {
  const u = readPstr16UTF16(pre, p);
  if (u && /^[\x20-\x7e]+$/.test(u.str)) {
    strings.push({ off: p, type: 'utf16', str: u.str });
    p += u.totalLen;
    continue;
  }
  const a = readPstr16Asciiz(pre, p);
  if (a && /^[\x20-\x7e]+$/.test(a.str)) {
    strings.push({ off: p, type: 'asciiZ', str: a.str });
    p += a.totalLen;
    continue;
  }
  p++;
}
for (const s of strings) console.log('  0x' + s.off.toString(16) + ' ' + s.type + ' "' + s.str + '"');

// ── PART 4: The 4-byte value at 0x43f8 — algorithm hunt ──
// Compare across saves: PRE/QUEUE/POST/T2-queue/T3/T4 (same campaign, growing file sizes)
console.log('\n\n=== PART 4: 4-byte value at 0x43f8 across same-campaign saves ===');
for (const b of bufs.slice(0, 6)) {
  const v = b.buf.readUInt32LE(0x43f8);
  console.log('  ' + b.name.padEnd(12) + ' size=' + b.buf.length.toString().padStart(9) +
    '  u32@0x43f8=0x' + v.toString(16).padStart(8, '0') + ' (' + v + ')');
}

// Is the 4-byte value related to file size? Or section count? Or section sum?
// Compute the difference between consecutive saves:
console.log('\n  Differences (each value - previous):');
for (let i = 1; i < 6; i++) {
  const b = bufs[i], prev = bufs[i - 1];
  const v = b.buf.readUInt32LE(0x43f8);
  const pv = prev.buf.readUInt32LE(0x43f8);
  const ds = b.buf.length - prev.buf.length;
  const dv = v - pv;
  console.log('    ' + prev.name + ' -> ' + b.name + '  Δsize=' + ds.toString().padStart(8) + '  Δvalue=' + dv.toString().padStart(8) + '  ratio=' + (ds !== 0 ? (dv / ds).toFixed(3) : 'N/A'));
}
