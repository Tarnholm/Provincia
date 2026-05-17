// Properly identify each settlement's stats block by walking the building list.
// Each settlement: stats_block → name → gap → default_set → header → buildings → trailer
// Next settlement's stats block starts after the previous settlement's trailer.

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

// For each settlement, walk forward from default_set+92 (header end) reading
// building pstr16 + 78 byte trailer until we hit the next settlement's name area
function walkBuildings(s, nextNameOff) {
  let p = s.defSet + 14 + 61;  // first building pstr16 starts at headerStart+61
  const buildings = [];
  while (p < nextNameOff) {
    // Each building: pstr16 + 78 bytes
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_]/.test(r.str) || r.str.length < 4) break;
    buildings.push({ name: r.str, off: p });
    p += r.totalLen + 78;
  }
  // After last building, there's a long 0xff trailer + the next settlement's stats block
  // Find where the 0xff run ends
  let trailerStart = p;
  // Walk backward through buildings; the LAST building's trailer extends until 0xff bytes end
  // Skip 0xff run
  while (p < buf.length && buf[p] === 0xff) p++;
  // The next stats block starts here
  return { buildings, trailerStart, statsStart: p };
}

const results = [];
for (let i = 0; i < settlements.length; i++) {
  const s = settlements[i];
  const nextNameOff = i + 1 < settlements.length ? settlements[i+1].nameOff : buf.length;
  const w = walkBuildings(s, nextNameOff);
  results.push({ ...s, ...w, nextStatsEnd: nextNameOff });
}

// Print first 8 settlements with their structure
console.log('=== First 8 settlements with parsed structure ===');
for (let i = 0; i < 8 && i < results.length; i++) {
  const r = results[i];
  const statsEnd = i + 1 < results.length ? results[i+1].statsStart : buf.length;
  // ACTUALLY: each settlement's STATS block sits BEFORE its name.
  // The PREVIOUS walk found where the previous settlement ended (statsStart).
  // That's where THIS settlement's stats block STARTS.
  // For settlement i, statsStart was computed during settlement i-1's walk.
  console.log('  ' + r.name.padEnd(20) + ' nameOff=0x' + r.nameOff.toString(16) +
    ' buildings=' + r.buildings.length +
    ' trailer_starts=0x' + r.trailerStart.toString(16) +
    ' next_stats_starts=0x' + r.statsStart.toString(16));
}

// Now: for each settlement EXCEPT the first, statsStart of the PREVIOUS settlement
// = THIS settlement's stats block START
console.log('\n=== Stats block size per settlement ===');
for (let i = 1; i < Math.min(15, results.length); i++) {
  const statsStart = results[i-1].statsStart;
  const statsEnd = results[i].nameOff;
  const statsSize = statsEnd - statsStart;
  console.log('  ' + results[i].name.padEnd(20) + ' stats=' + statsSize + ' bytes (0x' + statsStart.toString(16) + ' .. 0x' + statsEnd.toString(16) + ')');
}

// Now PRINT the actual stats block bytes for a few well-known settlements
function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
const TARGETS = ['Rome', 'Memphis', 'Carthage', 'Capua', 'Carthago_Nova', 'Asturica'];
for (const target of TARGETS) {
  const idx = results.findIndex(r => r.name === target);
  if (idx <= 0) continue;
  const statsStart = results[idx-1].statsStart;
  const statsEnd = results[idx].nameOff;
  console.log('\n=== ' + target + ' stats block (size ' + (statsEnd - statsStart) + ' bytes) ===');
  for (let row = 0; row < Math.ceil((statsEnd - statsStart) / 32); row++) {
    if (row > 16) break;
    const addr = statsStart + row * 32;
    if (addr + 32 > buf.length) break;
    console.log('  +' + String(row * 32).padStart(3) + ' (0x' + addr.toString(16) + '): ' + hex(addr, 32));
  }
}
