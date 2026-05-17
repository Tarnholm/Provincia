// Examine ALL Alexander saves for Sparta building changes

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Macedon'));

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

function getSettlementBuildings(buf, settlementName) {
  const defSets = findPstr16Asciiz(buf, 'default_set');
  for (const ds of defSets) {
    let nameOff = -1;
    for (const gap of [18, 19, 20, 21, 22, 23]) {
      for (let step = -50; step <= 0; step++) {
        const c = ds - gap + step;
        if (c < 0) continue;
        const r = readPstr16Utf16(buf, c);
        if (r && r.totalLen === ds - c - gap && r.str === settlementName) {
          nameOff = c;
          break;
        }
      }
      if (nameOff !== -1) break;
    }
    if (nameOff === -1) continue;
    let p = ds + 14 + 61;
    const buildings = [];
    while (true) {
      const r = readPstr16Asciiz(buf, p);
      if (!r) break;
      if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
      if (r.str === 'default_set') break;
      buildings.push({ name: r.str, tier: buf[p + r.totalLen + 4], culture: buf[p + r.totalLen + 76] });
      p += r.totalLen + 78;
    }
    return buildings;
  }
  return null;
}

// Extract turn number from filename
function getTurnNum(f) {
  const m = f.match(/Turn (\d+)/);
  return m ? parseInt(m[1]) : 0;
}

// Sort saves by turn number
allFiles.sort((a, b) => getTurnNum(a) - getTurnNum(b) || a.localeCompare(b));

console.log('=== Sparta buildings across ALL Macedon saves (sorted by turn) ===\n');
let prevBuildings = null;
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const bldgs = getSettlementBuildings(buf, 'Sparta');
  if (!bldgs) {
    console.log(f.substring(0, 70).padEnd(72) + ' NOT FOUND');
    continue;
  }
  const bldgStr = bldgs.map(b => b.name + '/t' + b.tier).join(', ');
  // Check for changes from previous
  let changeMark = '';
  if (prevBuildings) {
    for (let i = 0; i < bldgs.length; i++) {
      if (!prevBuildings[i] || prevBuildings[i].name !== bldgs[i].name || prevBuildings[i].tier !== bldgs[i].tier) {
        changeMark = ' ⚡CHANGED!';
        break;
      }
    }
    if (bldgs.length !== prevBuildings.length) changeMark = ' ⚡COUNT CHANGED!';
  }
  console.log(f.substring(0, 70).padEnd(72) + changeMark);
  console.log('  → ' + bldgStr);
  prevBuildings = bldgs;
}
