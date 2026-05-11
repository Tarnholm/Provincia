// Cross-validate: hinterland_roads payload+4 = road level (0=dirt, 1=paved, 2=highways)
// Check RoR Turn 1 save (same campaign T1, before player built any upgrades)
// vs rome10 (T5, may have built upgrades)
// AND check Alexander saves

const fs = require('fs');

function decodeRoads(filePath) {
  const buf = fs.readFileSync(filePath);
  const tok = Buffer.from('hinterland_roads\0');
  let p = 0;
  const recs = [];
  while ((p = buf.indexOf(tok, p)) !== -1) {
    recs.push({ namePos: p, level: buf[p + 17 + 4] });
    p++;
  }
  const dist = {};
  for (const r of recs) dist[r.level] = (dist[r.level] || 0) + 1;
  return { count: recs.length, dist };
}

const saves = [
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 98 End.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 99 Start.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_saveturn1start.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_saveturn2start.sav',
];

for (const s of saves) {
  if (!fs.existsSync(s)) { console.log('no file:', s); continue; }
  const r = decodeRoads(s);
  const fileName = s.split(/[\/\\]/).pop();
  console.log(fileName.padEnd(50), 'hinterland_roads count:', r.count, 'level dist:', JSON.stringify(r.dist));
}
