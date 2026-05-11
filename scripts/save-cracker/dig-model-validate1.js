// Task 4: Cross-validate settlement-model assignment against descr_strat
// Each settlement in descr_strat declares (faction, region, level).
// The save's settlement-model block has 24 model names like 'W_hellenistic_Large_Town'.
// These should derive from (culture, settlement_level).

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const DS  = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data/original_overrides/resource_quantity/world/maps/campaign/imperial_campaign/descr_strat.txt';

// Parse descr_strat settlements
const t = fs.readFileSync(DS,'utf8');
const lines = t.split(/\r?\n/);

const settlements = [];
let currentFaction = null;
let inSettlement = false;
let settlementBuf = null;
for(let i=0;i<lines.length;i++){
  const raw = lines[i];
  const l = raw.replace(/;.*$/,'').trim();
  let m = l.match(/^faction\s+(\w+)\s*,/i);
  if(m){ currentFaction = m[1]; continue; }
  if(l === 'settlement'){
    inSettlement = true;
    settlementBuf = {faction: currentFaction, level: null, region: null, faction_creator: null, population: null};
    continue;
  }
  if(inSettlement){
    const lvl = l.match(/^level\s+(\w+)/);
    if(lvl){ settlementBuf.level = lvl[1]; continue; }
    const reg = l.match(/^region\s+(\w+)/);
    if(reg){ settlementBuf.region = reg[1]; continue; }
    const fc = l.match(/^faction_creator\s+(\w+)/);
    if(fc){ settlementBuf.faction_creator = fc[1]; continue; }
    const pop = l.match(/^population\s+(\d+)/);
    if(pop){ settlementBuf.population = parseInt(pop[1]); continue; }
    // end of block when }... actually descr_strat blocks end with } on a single line
    if(l === '}'){
      settlements.push(settlementBuf);
      inSettlement = false;
      settlementBuf = null;
    }
  }
}
console.log('Settlements parsed:', settlements.length);

// Level distribution
const levelCounts = {};
for(const s of settlements){
  if(!s) continue;
  levelCounts[s.level||'(none)'] = (levelCounts[s.level||'(none)']||0)+1;
}
console.log('\nLevel histogram:');
Object.entries(levelCounts).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ', k, v));

// Faction histogram
const fcCounts = {};
for(const s of settlements){
  fcCounts[s.faction_creator||'(none)'] = (fcCounts[s.faction_creator||'(none)']||0)+1;
}
const fcSorted = Object.entries(fcCounts).sort((a,b)=>b[1]-a[1]);
console.log('\nfaction_creator (top 20):');
fcSorted.slice(0,20).forEach(([k,v])=>console.log('  ', k, v));

// What we need: culture per faction. Get from descr_sm_factions.txt or
// public/descr_sm_factions.txt
const SMF = 'C:/dev/Provincia/public/descr_sm_factions.txt';
const factionCulture = {};
if(fs.existsSync(SMF)){
  const smf = fs.readFileSync(SMF,'utf8');
  const smfLines = smf.split(/\r?\n/);
  let curF = null;
  for(const ll of smfLines){
    const l = ll.replace(/;.*$/,'').trim();
    let m = l.match(/^faction\s+(\w+)/);
    if(m){ curF = m[1]; continue; }
    m = l.match(/^culture\s+(\w+)/);
    if(m && curF){ factionCulture[curF] = m[1]; continue; }
  }
}
console.log('\nFaction → culture mappings loaded:', Object.keys(factionCulture).length);
const culSorted = Object.entries(factionCulture).slice(0,15);
console.log('Sample:', culSorted);

// Now build per-settlement (culture, level) and compare to model block
const cultureLevelHist = {};
for(const s of settlements){
  if(!s || !s.faction_creator || !s.level) continue;
  const cul = factionCulture[s.faction_creator] || '?';
  const k = cul + '/' + s.level;
  cultureLevelHist[k] = (cultureLevelHist[k]||0)+1;
}
console.log('\nculture/level histogram from descr_strat (top 30):');
Object.entries(cultureLevelHist).sort((a,b)=>b[1]-a[1]).slice(0,30).forEach(([k,v])=>console.log('  ', k, v));

// Now compare to save model block
const buf = fs.readFileSync(SAV);
const BLOCK_START = 0x1f47809, BLOCK_END = 0x1f8f9bc;
const validNames = ['Eastern_Town','Eastern_City','Eastern_Large_Town','Eastern_Huge_City',
  'Celtic_Town','Celtic_City','Celtic_Large_Town',
  'W_hellenistic_Town','W_hellenistic_City','W_hellenistic_Large_Town','W_hellenistic_Large_City','W_hellenistic_Huge_City',
  'Illyrian_Town','Illyrian_Large_Town',
  'Carthaginian_Town','Carthaginian_City','Carthaginian_Large_Town','Carthaginian_Huge_City',
  'Germanic_Town','Germanic_Large_Town',
  'Nomad_Town','Nomad_Large_Town',
  'Egyptian_Town','Egyptian_Large_Town'];
const validSet = new Set(validNames);

const modelCounts = {};
const setCoords = new Map();
let pos = BLOCK_START;
while(pos < BLOCK_END - 20){
  const lenP1 = buf.readUInt16LE(pos);
  if(lenP1 < 4 || lenP1 > 32){ pos++; continue; }
  const strLen = lenP1 - 1;
  if(pos+2+strLen+1 > buf.length){ pos++; continue; }
  const name = buf.slice(pos+2, pos+2+strLen).toString('ascii');
  if(!validSet.has(name) || buf[pos+2+strLen]!==0){ pos++; continue; }
  const headerEnd = pos+2+strLen+1;
  if(headerEnd+20 > buf.length){ pos++; continue; }
  const tag = buf.readUInt32LE(headerEnd);
  const X = buf.readUInt32LE(headerEnd+4);
  const Y = buf.readUInt32LE(headerEnd+8);
  if(tag===27||tag===29||tag===31){
    modelCounts[name] = (modelCounts[name]||0)+1;
    const k = X+'_'+Y;
    if(!setCoords.has(k)) setCoords.set(k, []);
    setCoords.get(k).push({name, tag});
    pos = headerEnd + 12;
    continue;
  }
  pos++;
}
console.log('\nSave model block counts:');
Object.entries(modelCounts).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ', k, v));

// For each unique settlement coord, what's the TAG=27 model name?
const tag27 = new Map();
for(const [coord, list] of setCoords){
  const t27 = list.filter(x=>x.tag===27);
  if(t27.length>0) tag27.set(coord, t27[0].name);
}
console.log('\nDistinct settlement coords with tag=27 (active):', tag27.size);

// Build model→culture mapping (from RTW conventions)
const modelCulture = {
  'W_hellenistic_': 'roman',
  'Celtic_': 'barbarian',
  'Carthaginian_': 'carthaginian',
  'Illyrian_': 'barbarian',
  'Eastern_': 'eastern',
  'Germanic_': 'barbarian',
  'Nomad_': 'nomad',
  'Egyptian_': 'egyptian'
};
function modelToCulture(m){
  for(const [pfx, cul] of Object.entries(modelCulture)){
    if(m.startsWith(pfx)) return cul;
  }
  return '?';
}
function modelToLevel(m){
  const suffix = m.replace(/^[^_]+_/, '');
  // suffix like "Town", "City", "Large_Town", "Huge_City", "Large_City"
  return suffix;
}

// Save model histogram by culture
const cultureSizeHist = {};
for(const [coord, name] of tag27){
  const cul = modelToCulture(name);
  const lvl = modelToLevel(name);
  const k = cul + '/' + lvl;
  cultureSizeHist[k] = (cultureSizeHist[k]||0)+1;
}
console.log('\nSave (culture/level) from tag=27 active settlements:');
Object.entries(cultureSizeHist).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ', k, v));

// Compare: do counts match?
// Build a comparison
const allCults = new Set([
  ...Object.keys(cultureLevelHist).map(k=>k.split('/')[0]),
  ...Object.keys(cultureSizeHist).map(k=>k.split('/')[0])
]);
console.log('\n--- COMPARISON (descr_strat → save active model) ---');
console.log('descr_strat culture set:', [...new Set(Object.keys(cultureLevelHist).map(k=>k.split('/')[0]))]);
console.log('save model culture set:', [...new Set(Object.keys(cultureSizeHist).map(k=>k.split('/')[0]))]);
