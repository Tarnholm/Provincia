// Track building changes across all Spain turn saves (T1-T4).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

// Use one representative save per turn (smallest = closest to turn-start)
const TURN_BUFS = {};
const TURN_LABEL = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      const buf = fs.readFileSync(path.join(BASE, f));
      if (!TURN_BUFS[t] || buf.length < TURN_BUFS[t].length) {
        TURN_BUFS[t] = buf;
        TURN_LABEL[t] = f;
      }
      break;
    }
  }
}
console.log('Saves used:');
for (const t of [1, 2, 3, 4]) console.log('  T' + t + ': ' + TURN_LABEL[t]);

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
    for (let step = -50; step <= 0; step++) {
      const c = ds - 18 + step;
      if (c < 0) continue;
      const r = readPstr16Utf16(buf, c);
      if (r && r.totalLen === ds - c - 18 && r.str === settlementName) {
        nameOff = c;
        break;
      }
    }
    if (nameOff === -1) continue;
    // Walk buildings strictly
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
    // Also read pop and PO
    const statsStart = nameOff - 583;
    const pop = buf.readUInt32LE(statsStart + 548);
    const po = buf.readUInt32LE(statsStart + 148);
    const inc = buf.readUInt32LE(statsStart + 456);
    return { buildings, pop, po, inc };
  }
  return null;
}

const SPAIN_SETTLEMENTS = ['Asturica', 'Scallabis', 'Carthago_Nova', 'Osca'];

for (const settlement of SPAIN_SETTLEMENTS) {
  console.log('\n=== ' + settlement + ' across T1-T4 ===');
  console.log('Turn  Pop    PO    Inc   Buildings');
  for (const t of [1, 2, 3, 4]) {
    const data = getSettlementBuildings(TURN_BUFS[t], settlement);
    if (!data) { console.log('  T' + t + '   NOT FOUND'); continue; }
    const bldgStr = data.buildings.map(b => b.name + '/t' + b.tier).join(', ');
    console.log('  T' + t + '   ' + String(data.pop).padStart(4) + '   ' +
      String(data.po).padStart(3) + '   ' + String(data.inc).padStart(4) + '  ' + bldgStr);
  }
}

// Also show all-faction summary across turns
console.log('\n=== Spain faction summary across T1-T4 ===');
for (const t of [1, 2, 3, 4]) {
  let totalPop = 0, totalInc = 0;
  for (const s of SPAIN_SETTLEMENTS) {
    const d = getSettlementBuildings(TURN_BUFS[t], s);
    if (d) { totalPop += d.pop; totalInc += d.inc; }
  }
  console.log('  T' + t + ': totalPop=' + totalPop + ' totalIncome/turn=' + totalInc);
}
