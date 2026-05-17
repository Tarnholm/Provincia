// FINAL building extractor — clean output for Provincia to consume.
// Per settlement: name, tile coords, owner-creator faction, population,
// public order, income, building list with tier + cultural flag.

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
  const tileX = buf.readUInt32LE(ds + 14 + 12);
  const tileY = buf.readUInt32LE(ds + 14 + 16);
  const statsStart = nameOff - 583;  // forced 583
  const creator = buf.readUInt32LE(statsStart);
  const settlementLevel = buf.readUInt32LE(statsStart + 12);
  const publicOrder = buf.readUInt32LE(statsStart + 148);
  const income = buf.readUInt32LE(statsStart + 456);
  const population = buf.readUInt32LE(statsStart + 548);
  settlements.push({
    name: readPstr16Utf16(buf, nameOff).str,
    defSet: ds,
    nameOff,
    tileX, tileY,
    creator,
    level: settlementLevel,
    populationOrder: publicOrder > 1000 ? null : publicOrder,
    income: income > 100000 ? null : income,
    population: population > 100000 ? null : population,
  });
}

// Walk buildings per settlement (loose walker)
function walkBuildings(s, nextNameOff) {
  let p = s.defSet + 14 + 61;
  const end = nextNameOff - 200;
  const buildings = [];
  while (p < end) {
    const ds = readPstr16Asciiz(buf, p);
    if (ds && ds.str === 'default_set') {
      p += ds.totalLen + 61;
      continue;
    }
    const r = readPstr16Asciiz(buf, p);
    if (r && r.str.length >= 4 && /^[a-z_][a-z_0-9]*$/.test(r.str)) {
      const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
      buildings.push({
        name: r.str,
        tier: data[4],
        culture: data[76],  // 1=matched, 2=neutral, 3=foreign, 255=N/A
      });
      p += r.totalLen + 78;
    } else {
      p++;
    }
  }
  return buildings;
}

for (let i = 0; i < settlements.length; i++) {
  const next = i + 1 < settlements.length ? settlements[i+1].nameOff : buf.length;
  settlements[i].buildings = walkBuildings(settlements[i], next);
}

// Print summary
console.log('=== CRACKER OUTPUT — 103 settlements with full state ===\n');
console.log('Settlement              fac  lvl  pop    PO   inc   buildings');
for (const s of settlements) {
  const bSummary = (s.buildings || []).map(b => b.name + (b.tier ? '/' + b.tier : '')).join(',');
  const truncated = bSummary.length > 80 ? bSummary.substring(0, 77) + '...' : bSummary;
  console.log('  ' + s.name.padEnd(22) + ' ' +
    String(s.creator).padStart(3) + '  ' +
    String(s.level).padStart(3) + '  ' +
    String(s.population).padStart(6) + ' ' +
    String(s.populationOrder).padStart(3) + ' ' +
    String(s.income).padStart(5) + '  ' +
    truncated);
}

// Stats
console.log('\n=== Aggregates ===');
const totalBldgs = settlements.reduce((s, x) => s + (x.buildings || []).length, 0);
const totalPop = settlements.reduce((s, x) => s + (x.population || 0), 0);
const totalInc = settlements.reduce((s, x) => s + (x.income || 0), 0);
console.log('Total settlements: ' + settlements.length);
console.log('Total buildings: ' + totalBldgs);
console.log('Total population: ' + totalPop);
console.log('Total income (all factions): ' + totalInc);
