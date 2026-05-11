// dig-diplo3.js — session 7: confirms minor-faction record format.
//
// Major faction records (session 5) have signature:
//   +8=100, +12=1, +24=self, +40=self, +44=6 (subSize=6), +48=N regions
//
// Minor faction records have a parallel signature:
//   +8=100, +12=1, +24=self, +40=self, +44=8 (subSize=8), +0=treasury, +48=treasury(dup)
//
// 23 major records + 216 minor records = 239 total class-100 records,
// matching RIS imperial's 239 factions (descr_strat count).
//
// Treasury at +0 (i32, can be negative for bankruptcy) is verified across all
// saves: starting values match descr_strat (sparta=5000, others=5500, 6000, ...).

const fs = require('fs');
const path = require('path');
const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

function listMinors(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i+24) !== i+24) continue;
    if (buf.readUInt32LE(i+40) !== i+40) continue;
    if (buf.readUInt32LE(i+8) !== 100) continue;
    if (buf.readUInt32LE(i+44) !== 8) continue;
    out.push({
      pos: i,
      treasury: buf.readInt32LE(i),
      dup48: buf.readUInt32LE(i+48),
      marker52: buf.readUInt32LE(i+52),
    });
  }
  return out;
}
function listMajors(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i+24) !== i+24) continue;
    if (buf.readUInt32LE(i+40) !== i+40) continue;
    if (buf.readUInt32LE(i+8) !== 100) continue;
    if (buf.readUInt32LE(i+44) !== 6) continue;
    out.push({ pos: i, treasury: buf.readInt32LE(i) });
  }
  return out;
}

const SAVES_LIST = [
  'save_savestartsparta.sav',
  'save_1.1.sav',
  'save_2.0.sav',
  'save_1turnchange.sav',
  'save_rome5..sav',
  'save_rome10.sav',
  'save_Autosave   Sparta   Turn 4 End.sav',
];

for (const f of SAVES_LIST) {
  const buf = fs.readFileSync(path.join(SAVES, f));
  const maj = listMajors(buf);
  const min = listMinors(buf);
  const minTreasures = min.slice(0, 8).map(r => r.treasury).join(',');
  console.log(f);
  console.log('  majors: ' + maj.length + ' (first 3 treasuries: ' + maj.slice(0,3).map(r=>r.treasury).join(',') + ')');
  console.log('  minors: ' + min.length + ' (first 8 treasuries: ' + minTreasures + ')');
  // dup48 always equals treasury?
  const dupOk = min.every(r => r.dup48 === (r.treasury < 0 ? r.treasury + 0x100000000 : r.treasury));
  console.log('  +48 dup equals treasury: ' + dupOk);
  console.log('  +52 marker distinct values: ' + new Set(min.map(r => r.marker52)).size);
}
