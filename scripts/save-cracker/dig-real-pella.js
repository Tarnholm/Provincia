// Check REAL Pella (settlement 0 at 0x10748) across T1, T7, T15

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

// Walk the FIRST settlement (index 0) of each save
const SAVES = [
  ['T1', 'save_17-05-2026   Macedon   Turn 1.sav'],
  ['T2', 'save_17-05-2026   Macedon   Turn 2.sav'],
  ['T7', 'save_Autosave   Macedon   Turn 7 New Governour in Sparta.sav'],
  ['T11', 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'],
  ['T15', 'save_Autosave   Macedon   Turn 15.sav'],
];

for (const [label, fname] of SAVES) {
  const buf = fs.readFileSync(path.join(BASE, fname));
  const defSets = findPstr16Asciiz(buf, 'default_set');
  const ds = defSets[0]; // first settlement
  console.log('\n=== ' + label + ' Settlement 0 (REAL Pella?) @ 0x' + ds.toString(16) + ' ===');
  let p = ds + 14 + 61;
  while (true) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str === 'default_set') break;
    const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
    console.log('  ' + r.str.padEnd(25) + ' byte+4=' + data[4] + ' byte+25=' + data[25] + ' byte+76=' + data[76]);
    p += r.totalLen + 78;
  }
}
