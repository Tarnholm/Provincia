// dig-diplo-ladder2.js
// For each consecutive save pair, walk the entire 239x239 matrix and
// report every cell where ANY u32 in the first 40 bytes of the record
// differs.

const fs = require('fs');
const path = require('path');

const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const STRIDE = 267;
const N = 239;
const MAT_START = 0xf8fd2;

const files = ['save_1.1.sav','save_2.1.sav','save_3.1.sav','save_4.1.sav','save_5.1.sav','save_6.1.sav','save_7.1.sav','save_8.1.sav','save_9.1.sav'];

// Faction-index → name (we only need to label a few)
const FNAMES = {0:'romans_julii',156:'messapians',207:'taras'};

function fname(i){ return FNAMES[i] || ('f'+i); }

function readCell(buf, base, r, c) {
  const off = base + (r * N + c) * STRIDE;
  return {
    off,
    prev: buf.readUInt32LE(off+0),
    curr: buf.readUInt32LE(off+4),
    u8: buf.readUInt32LE(off+8),
    u12: buf.readUInt32LE(off+12),
    u16: buf.readUInt32LE(off+16),
    u20: buf.readUInt32LE(off+20),
    u24: buf.readUInt32LE(off+24),
    u28: buf.readUInt32LE(off+28),
    u32: buf.readUInt32LE(off+32),
    u36: buf.readUInt32LE(off+36),
  };
}

function cellsDiffer(a, b) {
  return a.prev!==b.prev || a.curr!==b.curr || a.u8!==b.u8 || a.u12!==b.u12
      || a.u16!==b.u16 || a.u20!==b.u20 || a.u24!==b.u24 || a.u28!==b.u28
      || a.u32!==b.u32 || a.u36!==b.u36;
}

function fmtSigned(v){
  if (v < 0x80000000) return ''+v;
  return '-'+((0x100000000-v));
}

function formatCellDelta(a, b) {
  const parts=[];
  if (a.prev!==b.prev) parts.push(`prev:${a.prev}→${b.prev}`);
  if (a.curr!==b.curr) parts.push(`curr:${fmtSigned(a.curr)}→${fmtSigned(b.curr)}`);
  if (a.u8!==b.u8) parts.push(`+8:${fmtSigned(a.u8)}→${fmtSigned(b.u8)}`);
  if (a.u12!==b.u12) parts.push(`+12:${a.u12}→${b.u12}`);
  if (a.u16!==b.u16) parts.push(`+16:${a.u16}→${b.u16}`);
  if (a.u20!==b.u20) parts.push(`+20:${a.u20}→${b.u20}`);
  if (a.u24!==b.u24) parts.push(`+24:${a.u24}→${b.u24}`);
  if (a.u28!==b.u28) parts.push(`+28:${a.u28}→${b.u28}`);
  if (a.u32!==b.u32) parts.push(`+32:${a.u32}→${b.u32}`);
  if (a.u36!==b.u36) parts.push(`+36:${a.u36}→${b.u36}`);
  return parts.join(' ');
}

const bufs = files.map(f => fs.readFileSync(path.join(SAVES_DIR,f)));

for (let i = 0; i < files.length - 1; i++) {
  const A = bufs[i], B = bufs[i+1];
  console.log(`\n=== ${files[i]} → ${files[i+1]} ===`);
  let changes = 0;
  let romCount = 0, tarCount = 0, mesCount = 0, otherCount = 0;
  // Scan the whole matrix but cap reports
  const reports = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const ca = readCell(A, MAT_START, r, c);
      const cb = readCell(B, MAT_START, r, c);
      if (cellsDiffer(ca, cb)) {
        changes++;
        if (r===0 || c===0) romCount++;
        if (r===156 || c===156) mesCount++;
        if (r===207 || c===207) tarCount++;
        if (r!==0 && c!==0 && r!==156 && c!==156 && r!==207 && c!==207) otherCount++;
        // Always log Roman/Mes/Taras involvement, and a sample of others
        if (r===0 || c===0 || r===156 || c===156 || r===207 || c===207 || reports.length < 30) {
          reports.push(`  [${r}][${c}] (${fname(r)}→${fname(c)})  ${formatCellDelta(ca,cb)}`);
        }
      }
    }
  }
  console.log(`  total changed cells: ${changes}  rom-rows/cols:${romCount}  mes:${mesCount}  taras:${tarCount}  other:${otherCount}`);
  for (const r of reports.slice(0, 60)) console.log(r);
  if (reports.length > 60) console.log(`  ...and ${reports.length-60} more`);
}
