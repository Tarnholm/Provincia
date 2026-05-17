// Detailed Sparta inspection — check ALL bytes of building data for changes

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav'));

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

function findAllSpartaRecords(buf) {
  // Find ALL UTF-16 pstr16 "Sparta" markers
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(6, 0);
  const strBytes = Buffer.alloc(12);
  for (let i = 0; i < 6; i++) strBytes.writeUInt16LE('Sparta'.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

function getBuildingsAt(buf, defSetOff) {
  let p = defSetOff + 14 + 61;
  const buildings = [];
  while (true) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str === 'default_set') break;
    // Capture ALL 78 bytes of data
    const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
    buildings.push({ name: r.str, data });
    p += r.totalLen + 78;
  }
  return buildings;
}

function getTurnNum(f) {
  const m = f.match(/Turn (\d+)/);
  return m ? parseInt(m[1]) : 0;
}
allFiles.sort((a, b) => getTurnNum(a) - getTurnNum(b) || a.localeCompare(b));

console.log('=== Sparta full byte signatures across ALL Alexander saves ===\n');

let prevSig = null;
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const spartaHits = findAllSpartaRecords(buf);
  if (spartaHits.length === 0) continue;
  // Find the Sparta with associated default_set marker (skip duplicates if any)
  let foundBldgs = null;
  let foundOff = -1;
  for (const sp of spartaHits) {
    // Look for default_set within 50 bytes after Sparta pstr16 (14 bytes total: 2+12)
    const nameEnd = sp + 14;
    for (const gap of [18, 19, 20, 21, 22, 23]) {
      const dsOff = nameEnd + gap - 12 - 2 + 2;  // simpler approach
      // Just look forward for default_set
    }
    // Simpler: just search forward from nameEnd
    const dsLenBuf = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
    const ds = buf.indexOf(dsLenBuf, nameEnd);
    if (ds === -1 || ds - nameEnd > 30) continue;
    const bldgs = getBuildingsAt(buf, ds);
    if (bldgs.length > 0) {
      foundBldgs = bldgs;
      foundOff = sp;
      break;  // take first match
    }
  }
  if (!foundBldgs) {
    console.log(f.substring(0, 70).padEnd(72) + ' NO Sparta records');
    continue;
  }
  // Compute signature: hash of all building data
  let sig = '';
  for (const b of foundBldgs) sig += b.name + '|' + b.data.toString('hex') + '||';
  const changeMark = (prevSig !== null && prevSig !== sig) ? ' ⚡CHANGED!' : '';
  const tiers = foundBldgs.map(b => b.name + '/' + b.data[4]).join(' ');
  console.log(f.substring(0, 70).padEnd(72) + ' (' + foundBldgs.length + ' bldgs, found at 0x' + foundOff.toString(16) + ')' + changeMark);
  console.log('  tiers: ' + tiers);
  prevSig = sig;
}
