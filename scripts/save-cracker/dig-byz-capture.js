// Compare Byz siege start (T1) to Byz captured (T2 autoresolve) — find owner transfer + damage

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BYZ_SIEGE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 besige Byzantium.sav'));
const BYZ_CAPTURE = fs.readFileSync(path.join(BASE, 'save_Turn 2 autoresolve siege of Byz, clear victory, occupy.sav'));

console.log('Byz siege:   ' + BYZ_SIEGE.length);
console.log('Byz capture: ' + BYZ_CAPTURE.length);

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

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

// Find Byzantium in both saves
const byzSiege = findUtf16(BYZ_SIEGE, 'Byzantium');
const byzCap = findUtf16(BYZ_CAPTURE, 'Byzantium');
console.log('\nByzantium in siege:   0x' + byzSiege.toString(16));
console.log('Byzantium in capture: 0x' + byzCap.toString(16));

// Read stats fields for each
function getByzState(buf, nameOff) {
  if (nameOff < 583) return null;
  const owner = buf.readUInt32LE(nameOff - 583);
  const pop = buf.readUInt32LE(nameOff - 583 + 548);
  const po = buf.readUInt32LE(nameOff - 583 + 148);
  const income = buf.readUInt32LE(nameOff - 583 + 456);
  // Find default_set after name to get buildings + tile X/Y
  const dsTarget = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
  const ds = buf.indexOf(dsTarget, nameOff);
  if (ds === -1 || ds - nameOff > 50) return { owner, pop, po, income };
  const tileX = buf.readUInt32LE(ds + 14 + 12);
  const tileY = buf.readUInt32LE(ds + 14 + 16);
  // Walk buildings
  let p = ds + 14 + 61;
  const buildings = [];
  while (true) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str === 'default_set') break;
    const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
    buildings.push({ name: r.str, tier: data[4], culture: data[76] });
    p += r.totalLen + 78;
  }
  return { owner, pop, po, income, tileX, tileY, buildings };
}

const siege = getByzState(BYZ_SIEGE, byzSiege);
const cap = getByzState(BYZ_CAPTURE, byzCap);
console.log('\n=== Byzantium state comparison ===');
console.log('             Siege        Captured');
console.log('  Owner:     ' + String(siege?.owner ?? 'NA').padStart(8) + '    ' + String(cap?.owner ?? 'NA').padStart(8));
console.log('  Pop:       ' + String(siege?.pop ?? 'NA').padStart(8) + '    ' + String(cap?.pop ?? 'NA').padStart(8));
console.log('  Public order: ' + String(siege?.po ?? 'NA').padStart(8) + '    ' + String(cap?.po ?? 'NA').padStart(8));
console.log('  Income/turn: ' + String(siege?.income ?? 'NA').padStart(8) + '    ' + String(cap?.income ?? 'NA').padStart(8));
console.log('  Tile X,Y:  (' + siege?.tileX + ',' + siege?.tileY + ')  (' + cap?.tileX + ',' + cap?.tileY + ')');

if (siege?.buildings && cap?.buildings) {
  console.log('\n=== Building changes (siege → capture) ===');
  for (let i = 0; i < Math.max(siege.buildings.length, cap.buildings.length); i++) {
    const s = siege.buildings[i];
    const c = cap.buildings[i];
    const sStr = s ? s.name + '/t' + s.tier + '/c' + s.culture : '-';
    const cStr = c ? c.name + '/t' + c.tier + '/c' + c.culture : '-';
    const marker = (sStr === cStr) ? '' : ' ⚡CHANGED';
    console.log('  ' + i + ': siege=' + sStr.padEnd(35) + ' capture=' + cStr + marker);
  }
}
