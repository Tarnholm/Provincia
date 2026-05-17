// Track Pella and Sparta building changes across Alexander campaign turns

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

// Key turn saves to compare
const TURN_SAVES = {
  'T1 baseline':         'save_17-05-2026   Macedon   Turn 1.sav',
  'T1 queued buildings': 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav',
  'T2 baseline':         'save_17-05-2026   Macedon   Turn 2.sav',
  'T2 retrain+repair':   'save_Macedon   Turn 2 retrain unit, repair building and queue new .sav',
  'T7 New Governor':     'save_Autosave   Macedon   Turn 7 New Governour in Sparta.sav',
  'T11 enslaved':        'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav',
  'T12 upgrades':        'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav',
  'T14 End':             'save_Autosave   Macedon   Turn 14 End.sav',
  'T15 Start':           'save_Autosave   Macedon   Turn 15 Start.sav',
};

const BUFS = {};
for (const [label, fname] of Object.entries(TURN_SAVES)) {
  try {
    BUFS[label] = fs.readFileSync(path.join(BASE, fname));
    console.log('Loaded ' + label + ' (' + BUFS[label].length + ' bytes)');
  } catch (e) {
    console.log('FAILED to load ' + label);
  }
}

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

function getSettlementData(buf, settlementName) {
  const defSets = findPstr16Asciiz(buf, 'default_set');
  for (const ds of defSets) {
    let nameOff = -1;
    // Alexander uses 19-byte gap, vanilla uses 18 — try both
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
    // Walk buildings
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
    return { buildings };
  }
  return null;
}

// Compare Pella and Sparta across all loaded saves
const SETTLEMENTS = ['Pella', 'Sparta', 'Epidamnus', 'Bylazora', 'Larissa'];

for (const settlement of SETTLEMENTS) {
  console.log('\n=== ' + settlement + ' building list across Alexander turns ===');
  for (const [label, buf] of Object.entries(BUFS)) {
    const data = getSettlementData(buf, settlement);
    if (!data) {
      console.log('  ' + label.padEnd(22) + ' NOT FOUND');
      continue;
    }
    const bldgStr = data.buildings.map(b => b.name + '/t' + b.tier).join(', ');
    console.log('  ' + label.padEnd(22) + ' (' + data.buildings.length + ' bldgs): ' + bldgStr);
  }
}
