// Check if Sparta has a dual building list (second default_set marker after first list)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

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

function findSparta(buf) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(6, 0);
  const strBytes = Buffer.alloc(12);
  for (let i = 0; i < 6; i++) strBytes.writeUInt16LE('Sparta'.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

// LOOSE walker — keep walking past default_set markers, capture all building lists
function walkAllBuildings(buf, startOff) {
  // Find first default_set after Sparta name
  const dsTarget = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
  const firstDS = buf.indexOf(dsTarget, startOff);
  if (firstDS === -1) return [];

  // Find SECOND default_set (next one)
  const secondDS = buf.indexOf(dsTarget, firstDS + 14);
  // (could be next settlement's, but if close enough, might be Sparta's second list)

  const lists = [];
  let listIdx = 0;
  let p = firstDS + 14 + 61;  // skip default_set + 61-byte header
  let currentList = [];
  while (p < buf.length) {
    // Check if this is a default_set (start of new list within same settlement)
    const ds = readPstr16Asciiz(buf, p);
    if (ds && ds.str === 'default_set') {
      lists.push(currentList);
      currentList = [];
      p += ds.totalLen + 61;  // skip the new default_set header too
      continue;
    }
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str.length < 4) break;
    currentList.push({
      name: r.str,
      tier: buf[p + r.totalLen + 4],
      culture: buf[p + r.totalLen + 76],
      hash: buf.readUInt32LE(p + r.totalLen),
    });
    p += r.totalLen + 78;
  }
  if (currentList.length > 0) lists.push(currentList);
  return lists;
}

const TURNS_TO_CHECK = [
  'save_17-05-2026   Macedon   Turn 1.sav',
  'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav',
  'save_17-05-2026   Macedon   Turn 2.sav',
  'save_Autosave   Macedon   Turn 3 merge armies.sav',
  'save_Autosave   Macedon   Turn 7 New Governour in Sparta.sav',
  'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav',
  'save_Autosave   Macedon   Turn 14 End.sav',
  'save_Autosave   Macedon   Turn 15.sav',
];

for (const fname of TURNS_TO_CHECK) {
  const buf = fs.readFileSync(path.join(BASE, fname));
  const spOff = findSparta(buf);
  const lists = walkAllBuildings(buf, spOff);
  console.log('\n=== ' + fname + ' (' + lists.length + ' lists) ===');
  for (let i = 0; i < lists.length; i++) {
    console.log('  List ' + i + ' (' + lists[i].length + ' buildings):');
    for (const b of lists[i]) {
      console.log('    ' + b.name.padEnd(25) + ' tier=' + b.tier + ' culture=' + b.culture);
    }
  }
}
