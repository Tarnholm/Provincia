// dig-reputation-01-survey.js
// Survey the Spain campaign saves: parse class-100 faction records across
// turns 1-4, identify Spain (player) and Carthage records, and confirm the
// records line up across saves so we can diff them.
//
// Spain campaign: player = spain, trades with Carthage T2, declares war on
// Carthage T4 (breaks the trade = a betrayal). Spain's GLOBAL STANDING /
// REPUTATION should worsen at T4.

const fs = require('fs');
const path = require('path');
const X = require('../../src/saveCrackerExtras.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

const SAVES = {
  T1:        'save_17-05-2026   Spain   Turn 1.sav',
  T2trade:   'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav',
  T3spy:     'save_Autosave   Spain   Turn 3 inflitrated city with spy..sav',
  T3end:     'save_Autosave   Spain   Turn 3 End.sav',
  T4start:   'save_Autosave   Spain   Turn 4 Start.sav',
  T4war:     'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav',
  T4besiege: 'save_Autosave   Spain   Turn 4 besiged corduba.sav',
  T4:        'save_Autosave   Spain   Turn 4.sav',
};

// descr_sm_factions order (vanilla): used to label factionId. We only care
// about identifying spain + carthage; print all so we can eyeball.
function label(fid) { return 'fid=' + fid; }

for (const [tag, file] of Object.entries(SAVES)) {
  const full = path.join(BASE, file);
  if (!fs.existsSync(full)) { console.log(`[${tag}] MISSING: ${file}`); continue; }
  const buf = fs.readFileSync(full);
  const recs = X.parseFactionTreasuries(buf);
  console.log(`\n=== ${tag}  (${file})  size=${buf.length}  records=${recs.length} ===`);
  for (const r of recs) {
    console.log(`  rec@0x${r.offset.toString(16).padStart(8,'0')}  ${label(r.factionId)}  ai=${r.aiPersonalityIndex}  regions=${r.regionCount}  treasury=${r.treasury}  turnStart=${r.turnStartTreasury}`);
  }
}
