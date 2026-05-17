// Investigate the cluster of records at 0x69000-0x6c000

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));
const T_FILES = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      if (!T_FILES[t]) T_FILES[t] = fs.readFileSync(path.join(BASE, f));
      break;
    }
  }
}
const buf = T_FILES[4];

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Find all self-pointer records in 0x68000-0x6c000
const records = [];
for (let off = 0x68000; off < 0x6c000; off += 1) {
  const v = buf.readUInt32LE(off);
  if (v === off) {
    const size = buf.readUInt32LE(off + 4);
    if (size > 50 && size < 5000) {
      records.push({ off, size });
    }
  }
}
console.log('Total self-pointer records in 0x68000-0x6c000: ' + records.length);

// First 40 records with bytes
console.log('\n=== First 40 records (off, size, first 20 bytes after header) ===');
for (const r of records.slice(0, 40)) {
  // Read 28 bytes starting at off (which includes self_ptr + size + 20 data bytes)
  console.log('  0x' + r.off.toString(16) + ' size=' + String(r.size).padStart(4) + ' first-bytes: ' + hex(buf, r.off + 8, 24));
}

// Check if any of these have TREASURY-like u32 values
console.log('\n=== Looking for treasury values within these records ===');
// For each record, dump u32 at +12, +16, +20, +24, +32, +40
for (const r of records.slice(0, 15)) {
  process.stdout.write('  0x' + r.off.toString(16) + ' sz=' + r.size + ': ');
  for (let off = 12; off <= 60; off += 4) {
    if (r.off + off + 4 > buf.length) break;
    const v = buf.readUInt32LE(r.off + off);
    if (v < 100000 && v > 0) {
      process.stdout.write(' +' + off + '=' + v);
    }
  }
  console.log();
}

// Check across turns for varying treasury at these record positions
console.log('\n=== Cross-turn variation at record +12, +16, +20, +24 ===');
const len = Math.min(...Object.values(T_FILES).map(b => b.length));
for (const r of records.slice(0, 20)) {
  for (const off of [12, 16, 20, 24, 32, 40, 48]) {
    if (r.off + off + 4 > len) break;
    const vals = [1, 2, 3, 4].map(t => T_FILES[t].readInt32LE(r.off + off));
    if (new Set(vals).size === 1) continue;
    if (vals.some(v => v < 0 || v > 100000)) continue;
    if (vals.every(v => v % 256 === 0)) continue;
    // Monotonic check
    let inc = 0, dec = 0;
    for (let i = 1; i < 4; i++) {
      if (vals[i] > vals[i-1]) inc++;
      else if (vals[i] < vals[i-1]) dec++;
    }
    if (inc >= 2 || dec >= 2) {
      console.log('  0x' + r.off.toString(16) + ' +' + off + ': T1..T4=[' + vals.join(', ') + ']');
    }
  }
}
