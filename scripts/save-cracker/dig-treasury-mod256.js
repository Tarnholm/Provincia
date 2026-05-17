// Treasury must NOT be a multiple of 256 (those values are fixed-point coords).
// Also try u16 (2-byte values 1000-30000) and i64 (8-byte values).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const SAVES = [];
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  SAVES.push({ name: f, buf, size: buf.length });
}
SAVES.sort((a, b) => a.size - b.size);
const T1_SAVES = SAVES.filter(s => s.name.includes('Turn 1'));
const T4_SAVES = SAVES.filter(s => s.name.includes('Turn 4'));

const len = Math.min(...SAVES.map(s => s.buf.length));

// 1. u32 in 1000-30000, NOT divisible by 256 (excluding fixed-point coords)
console.log('=== u32 candidates NOT multiples of 256 ===');
const candidates = [];
for (let off = 0x100; off < len - 4; off += 4) {
  const t1Vals = T1_SAVES.map(s => s.buf.readInt32LE(off));
  const t4Vals = T4_SAVES.map(s => s.buf.readInt32LE(off));
  const t1v = t1Vals[0];
  const t4v = t4Vals[0];
  if (t1v < 1000 || t1v > 30000) continue;
  if (t4v < 1000 || t4v > 30000) continue;
  if (t1v % 256 === 0 && t4v % 256 === 0) continue;  // skip fixed-point
  if (new Set(t1Vals).size !== 1 || new Set(t4Vals).size !== 1) continue;
  if (t1v === t4v) continue;
  candidates.push({ off, t1v, t4v });
}
console.log('Found ' + candidates.length + ' non-fixed-point candidates');
candidates.sort((a, b) => Math.abs(a.t4v - a.t1v) - Math.abs(b.t4v - b.t1v));
console.log('\nTop 30 sorted by spread:');
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ' T1=' + c.t1v + ' T4=' + c.t4v + ' Δ=' + (c.t4v - c.t1v));
}

// 2. u16 in 1000-30000
console.log('\n=== u16 candidates (1000-30000, NOT div by 256) ===');
const u16cands = [];
for (let off = 0x100; off < len - 2; off += 2) {
  const t1Vals = T1_SAVES.map(s => s.buf.readUInt16LE(off));
  const t4Vals = T4_SAVES.map(s => s.buf.readUInt16LE(off));
  const t1v = t1Vals[0];
  const t4v = t4Vals[0];
  if (t1v < 1000 || t1v > 30000) continue;
  if (t4v < 1000 || t4v > 30000) continue;
  if (t1v % 256 === 0 && t4v % 256 === 0) continue;
  if (new Set(t1Vals).size !== 1 || new Set(t4Vals).size !== 1) continue;
  if (t1v === t4v) continue;
  u16cands.push({ off, t1v, t4v });
}
console.log('Found ' + u16cands.length + ' u16 candidates');
u16cands.sort((a, b) => Math.abs(a.t4v - a.t1v) - Math.abs(b.t4v - b.t1v));
console.log('Top 20:');
for (const c of u16cands.slice(0, 20)) {
  console.log('  u16@0x' + c.off.toString(16) + ' T1=' + c.t1v + ' T4=' + c.t4v + ' Δ=' + (c.t4v - c.t1v));
}

// 3. Float32 in 1000-30000
console.log('\n=== Float32 candidates (1000-30000 magnitude) ===');
const fcands = [];
for (let off = 0x100; off < len - 4; off += 4) {
  const t1f = T1_SAVES[0].buf.readFloatLE(off);
  const t4f = T4_SAVES[0].buf.readFloatLE(off);
  if (!isFinite(t1f) || !isFinite(t4f)) continue;
  if (t1f < 1000 || t1f > 30000) continue;
  if (t4f < 1000 || t4f > 30000) continue;
  const t1Vals = T1_SAVES.map(s => s.buf.readFloatLE(off));
  const t4Vals = T4_SAVES.map(s => s.buf.readFloatLE(off));
  if (new Set(t1Vals).size !== 1 || new Set(t4Vals).size !== 1) continue;
  if (t1f === t4f) continue;
  fcands.push({ off, t1: t1f, t4: t4f });
}
console.log('Found ' + fcands.length + ' float candidates');
fcands.sort((a, b) => Math.abs(a.t4 - a.t1) - Math.abs(b.t4 - b.t1));
console.log('Top 15:');
for (const c of fcands.slice(0, 15)) {
  console.log('  f32@0x' + c.off.toString(16) + ' T1=' + c.t1.toFixed(1) + ' T4=' + c.t4.toFixed(1));
}
