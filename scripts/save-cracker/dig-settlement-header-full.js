// Decode more fields from the default_set header.
// Known: u32[3]=X, u32[4]=Y at default_set+14.
// Look for: population, owner-faction, settlement-level, public-order.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const t1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const defSets = findPstr16Asciiz(t1, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -20; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(t1, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  settlements.push({
    name: nameOff !== -1 ? readPstr16Utf16(t1, nameOff).str : '???',
    defSet: ds,
    headerStart: ds + 14
  });
}

// Print every u32 in the first 96 bytes of the header for the first 30 settlements
console.log('=== Default_set header u32 fields for first 30 settlements ===');
console.log('settlement_name   u32[0]      u32[1]      u32[2]      u32[3]=X u32[4]=Y u32[5..23]');
for (const s of settlements.slice(0, 30)) {
  const h = s.headerStart;
  const fields = [];
  for (let i = 0; i < 24; i++) fields.push(t1.readUInt32LE(h + i * 4));
  console.log('  ' + s.name.padEnd(20) + ' ' + fields.slice(0, 5).map(v => String(v).padStart(8)).join(' ') +
    '  ' + fields.slice(5, 17).map(v => String(v).padStart(6)).join(' '));
}

// Now look at u32[5..16] across settlements to find a VARYING field that could be:
//   - settlement level (0-5)
//   - region_id (0-200)
//   - culture (0-7)
//   - owner faction (0-19)
console.log('\n=== Field-by-field analysis (looking for varying-but-bounded fields) ===');
const fieldStats = {};
for (let i = 5; i < 24; i++) {
  const vals = settlements.map(s => t1.readUInt32LE(s.headerStart + i * 4));
  const unique = new Set(vals);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  fieldStats[i] = { unique: unique.size, min, max, samples: vals.slice(0, 5) };
}
for (const [i, stats] of Object.entries(fieldStats)) {
  if (stats.unique > 1 && stats.unique < 50) {
    console.log('  u32[' + i + '] (byte+' + (i*4) + '): unique=' + stats.unique + ' min=' + stats.min + ' max=' + stats.max + ' samples=[' + stats.samples.join(',') + ']');
  }
}

// Also try u16 and u8 reads, in case fields are smaller
console.log('\n=== u16 fields (varying-but-bounded across settlements) ===');
const u16FieldStats = {};
for (let i = 10; i < 96; i += 2) {  // start after X,Y (which we know)
  const vals = settlements.map(s => t1.readUInt16LE(s.headerStart + i));
  const unique = new Set(vals);
  if (unique.size > 1 && unique.size < 30 && Math.max(...vals) < 1000) {
    console.log('  u16@+' + i + ': unique=' + unique.size + ' min=' + Math.min(...vals) + ' max=' + Math.max(...vals) + ' samples=[' + vals.slice(0, 8).join(',') + ']');
  }
}
console.log('\n=== u8 fields (varying-but-bounded) ===');
for (let i = 20; i < 200; i++) {
  const vals = settlements.map(s => s.headerStart + i < t1.length ? t1[s.headerStart + i] : 0);
  const unique = new Set(vals);
  if (unique.size > 1 && unique.size < 25 && Math.max(...vals) < 50 && Math.min(...vals) >= 0) {
    console.log('  u8@+' + i + ': unique=' + unique.size + ' min=' + Math.min(...vals) + ' max=' + Math.max(...vals) + ' samples=[' + vals.slice(0, 8).join(',') + ']');
  }
}
