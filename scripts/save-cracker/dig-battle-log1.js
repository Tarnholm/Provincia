// Find FAMOUS_BATTLE_DETAIL section instances.
// The HST declares the schema, but instances live in the body.
// Strategy: look for ASCII tokens like "battle", "famous_battle", "battle_site", etc.

const fs = require('fs');

const saves = [
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 99 Start.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_damagedturn1.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_damagedturn2.sav',
];

function probe(filePath) {
  const buf = fs.readFileSync(filePath);
  console.log('\n=== ' + filePath.split(/[\/\\]/).pop() + ' (' + buf.length + ' bytes) ===');
  const tokens = ['battle', 'Battle', 'BATTLE', 'famous_battle', 'FAMOUS_BATTLE', 'siege', 'Siege'];
  for (const t of tokens) {
    const tok = Buffer.from(t);
    let p = 0, count = 0;
    const positions = [];
    while ((p = buf.indexOf(tok, p)) !== -1) {
      count++;
      if (positions.length < 5) positions.push(p);
      p++;
    }
    console.log(' "' + t + '" count:', count, 'first:', positions.slice(0, 3).map(p => '0x'+p.toString(16)));
  }
  // Also check 'sieges', 'autoresolve'
  const t2 = ['sieges', 'autoresolve', 'casualties'];
  for (const t of t2) {
    const tok = Buffer.from(t);
    let p = 0, count = 0;
    while ((p = buf.indexOf(tok, p)) !== -1) { count++; p++; }
    console.log(' "' + t + '" count:', count);
  }
}

for (const s of saves) {
  if (!fs.existsSync(s)) continue;
  probe(s);
}
