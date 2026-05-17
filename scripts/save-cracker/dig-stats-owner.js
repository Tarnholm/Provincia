// Verify u32@+0 of stats block = OWNER FACTION ID

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

// Map each settlement to its faction-id (u32@+0 of stats block)
for (let i = 1; i < results.length; i++) {
  results[i].statsBlockStart = results[i-1].statsStart;
  const facId = buf.readUInt32LE(results[i].statsBlockStart);
  results[i].facId = facId;
}

// Group by faction-id
const byFac = {};
for (const r of results.slice(1)) {
  if (!byFac[r.facId]) byFac[r.facId] = [];
  byFac[r.facId].push(r.name);
}

console.log('=== Settlements grouped by owner faction-id (from stats_block+0) ===');
const sortedFacs = Object.keys(byFac).map(Number).sort((a, b) => a - b);
for (const f of sortedFacs) {
  console.log('  fac=' + f + ' (' + byFac[f].length + ' settlements): ' + byFac[f].join(', '));
}

// Cross-validation: compare to the static owner table at 0x1190
const ownerTable = [];
for (let off = 0x1190; off < 0x14a0; off += 12) {
  if (off + 12 > buf.length) break;
  const facId = buf.readUInt32LE(off + 4);
  if (facId > 30) break;
  ownerTable.push({ off, facId });
}

console.log('\n=== Cross-validation: stats-block count vs static-table count ===');
const tableCounts = {};
for (const e of ownerTable) tableCounts[e.facId] = (tableCounts[e.facId] || 0) + 1;
console.log('  Faction-id | from stats block | from static table 0x1190');
for (let f = 0; f <= 20; f++) {
  const sCount = (byFac[f] || []).length;
  const tCount = tableCounts[f] || 0;
  if (sCount + tCount > 0) {
    const match = sCount === tCount ? ' ✓' : sCount > 0 && tCount > 0 ? ' ~' : '';
    console.log('  fac=' + String(f).padStart(2) + ':       ' + String(sCount).padStart(3) + '              ' + String(tCount).padStart(3) + match);
  }
}
