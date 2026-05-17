// Deep-dive the 583-byte stats block — find public order, population, garrison, etc.

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
  settlements.push({ name: readPstr16Utf16(buf, nameOff).str, defSet: ds, nameOff });
}

function walkBuildings(s, nextNameOff) {
  let p = s.defSet + 14 + 61;
  while (p < nextNameOff) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_]/.test(r.str) || r.str.length < 4) break;
    p += r.totalLen + 78;
  }
  while (p < buf.length && buf[p] === 0xff) p++;
  return p;
}

const results = [];
for (let i = 0; i < settlements.length; i++) {
  const nextOff = i + 1 < settlements.length ? settlements[i+1].nameOff : buf.length;
  const next = walkBuildings(settlements[i], nextOff);
  results.push({ ...settlements[i], statsStart: next });
}
for (let i = 1; i < results.length; i++) {
  results[i].statsBlockStart = results[i-1].statsStart;
  results[i].statsBlockSize = results[i].nameOff - results[i].statsBlockStart;
  results[i].facId = buf.readUInt32LE(results[i].statsBlockStart);
}

const VALID = results.filter(r => r.statsBlockSize === 583 && r.facId !== undefined && r.facId < 30);
console.log('Valid 583-byte settlements: ' + VALID.length);

// Probe ALL offsets in the stats block. Find which offsets have:
// 1. Small positive integer values (10-10000)
// 2. Vary across settlements (not constant)
// 3. Distribution looks meaningful

console.log('\n=== Detailed field samples for known settlements ===');
const SAMPLES = ['Rome', 'Carthago_Nova', 'Asturica', 'Tarentum', 'Croton', 'Messana', 'Caralis', 'Palma', 'Thapsus'];
for (const target of SAMPLES) {
  const s = VALID.find(v => v.name === target);
  if (!s) { console.log('\n--- ' + target + ': not 583-byte block ---'); continue; }
  console.log('\n--- ' + target + ' (fac=' + s.facId + ') ---');
  // Dump all u32 fields
  const fields = {};
  for (let off = 0; off < 583 - 3; off += 4) {
    const v = buf.readUInt32LE(s.statsBlockStart + off);
    if (v > 0 && v < 10000) {
      fields[off] = v;
    }
  }
  // Print as columns
  const offs = Object.keys(fields).map(Number);
  for (let i = 0; i < offs.length; i += 8) {
    const chunk = offs.slice(i, i + 8);
    console.log('  ' + chunk.map(o => '+' + String(o).padStart(3) + '=' + String(fields[o]).padStart(5)).join('  '));
  }
}

// Also: check the +20 field (4 unique values: 0, 768, 256, 512)
// could be SETTLEMENT_LEVEL (village=0, town=1, large_town=2, city=3, etc) × 256
console.log('\n=== +20 field across valid settlements ===');
for (const s of VALID.slice(0, 20)) {
  const v = buf.readUInt32LE(s.statsBlockStart + 20);
  console.log('  ' + s.name.padEnd(20) + ' fac=' + s.facId + ' +20=' + v + ' (÷256=' + v/256 + ')');
}
