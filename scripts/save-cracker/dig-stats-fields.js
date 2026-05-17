// Cross-tabulate u32 fields across all 583-byte stats blocks.
// Find consistent fields (population, public order, culture, etc.)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
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

const defSets = findPstr16Asciiz(buf, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  settlements.push({
    name: readPstr16Utf16(buf, nameOff).str,
    defSet: ds,
    nameOff,
  });
}

function walkBuildings(s, nextNameOff) {
  let p = s.defSet + 14 + 61;
  const buildings = [];
  while (p < nextNameOff) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_]/.test(r.str) || r.str.length < 4) break;
    buildings.push({ name: r.str, off: p });
    p += r.totalLen + 78;
  }
  while (p < buf.length && buf[p] === 0xff) p++;
  return { buildings, statsStart: p };
}

const results = [];
for (let i = 0; i < settlements.length; i++) {
  const nextOff = i + 1 < settlements.length ? settlements[i+1].nameOff : buf.length;
  const w = walkBuildings(settlements[i], nextOff);
  results.push({ ...settlements[i], ...w });
}

// Set stats block for each settlement EXCEPT first (no prev)
for (let i = 1; i < results.length; i++) {
  results[i].statsBlockStart = results[i-1].statsStart;
  results[i].statsBlockEnd = results[i].nameOff;
  results[i].statsBlockSize = results[i].statsBlockEnd - results[i].statsBlockStart;
}

// Keep only 583-byte ones (most reliable)
const VALID = results.filter(r => r.statsBlockSize === 583);
console.log('Settlements with 583-byte stats blocks: ' + VALID.length + ' / ' + results.length);

// For each u32 offset in the 583-byte block, find values across settlements
console.log('\n=== u32 field analysis across 583-byte blocks ===');
console.log('Showing offsets where values are bounded AND vary');
for (let off = 0; off < 583 - 3; off += 4) {
  const vals = VALID.map(s => buf.readUInt32LE(s.statsBlockStart + off));
  const unique = new Set(vals);
  // Filter: must vary, and most values are bounded
  if (unique.size === 1) continue;
  const bounded = vals.filter(v => v < 100000).length;
  const ratio = bounded / vals.length;
  if (ratio < 0.8) continue;
  // Also filter: most values not all the same
  if (unique.size < 3) continue;
  // Most interesting: 2-30 unique values, all small
  if (unique.size > 30) continue;
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const dist = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => k + '×' + v).join(', ');
  console.log('  +' + String(off).padStart(3) + ': ' + unique.size + ' unique. Top: ' + dist);
}

// Now sample the values at promising offsets for known settlements
const TARGETS = ['Rome', 'Carthago_Nova', 'Capua', 'Athens', 'Asturica', 'Numantia',
  'Tarentum', 'Croton', 'Lilybaeum', 'Caralis'];
console.log('\n=== Selected fields for known settlements ===');
const PROBE_OFFSETS = [0, 4, 12, 16, 24, 44, 48, 52, 56, 60, 68, 80, 320];
console.log('settlement      ' + PROBE_OFFSETS.map(o => '+' + String(o).padStart(3)).join(' '));
for (const target of TARGETS) {
  const s = VALID.find(v => v.name === target);
  if (!s) { console.log('  ' + target.padEnd(15) + ' [not 583-byte block]'); continue; }
  const fields = PROBE_OFFSETS.map(o => {
    const v = buf.readUInt32LE(s.statsBlockStart + o);
    return v > 100000 ? '0x' + v.toString(16).slice(-7) : String(v);
  });
  console.log('  ' + target.padEnd(15) + fields.map(f => f.padStart(5)).join(' '));
}
