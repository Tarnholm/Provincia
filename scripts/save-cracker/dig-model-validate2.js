// Validate model assignments with proper culture parsing
const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const DS  = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data/original_overrides/resource_quantity/world/maps/campaign/imperial_campaign/descr_strat.txt';
const SMF = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data/descr_sm_factions.txt';

// Parse descr_sm_factions.txt (JSON-like with "key": value patterns)
const smfText = fs.readFileSync(SMF,'utf8');
const factionCulture = {};
// Find all "faction_name": ; followed by ... "culture": "value"
const re = /"(\w+)":\s*;[^\n]*\n\s*\{[^}]+?"culture":\s*"(\w+)"/gs;
let m;
while((m = re.exec(smfText))){
  factionCulture[m[1]] = m[2];
}
console.log('Factions with culture loaded:', Object.keys(factionCulture).length);
const cultSet = {};
for(const c of Object.values(factionCulture)) cultSet[c]=(cultSet[c]||0)+1;
console.log('Culture distribution:', cultSet);

// Parse descr_strat settlements
const t = fs.readFileSync(DS,'utf8');
const lines = t.split(/\r?\n/);
const settlements = [];
let currentFaction = null;
let inSet = false;
let buf = null;
for(let i=0;i<lines.length;i++){
  const raw = lines[i];
  const l = raw.replace(/;.*$/,'').trim();
  let mm = l.match(/^faction\s+(\w+)\s*,/i);
  if(mm){ currentFaction = mm[1]; continue; }
  if(l === 'settlement'){ inSet=true; buf={faction:currentFaction}; continue; }
  if(!inSet) continue;
  const lvl = l.match(/^level\s+(\w+)/);
  if(lvl){ buf.level = lvl[1]; continue; }
  const reg = l.match(/^region\s+(\w+)/);
  if(reg){ buf.region = reg[1]; continue; }
  const fc = l.match(/^faction_creator\s+(\w+)/);
  if(fc){ buf.faction_creator = fc[1]; continue; }
  if(l === '}'){ settlements.push(buf); inSet=false; buf=null; }
}
console.log('Settlements parsed:', settlements.length);

// Build descr_strat culture+level distribution
const culLevelHist = {};
const culLevelDetail = {}; // (cul/level) → [faction list]
for(const s of settlements){
  if(!s) continue;
  const cul = factionCulture[s.faction_creator || s.faction] || '?';
  const lvl = s.level || '?';
  const k = cul + '/' + lvl;
  culLevelHist[k] = (culLevelHist[k]||0)+1;
  if(!culLevelDetail[k]) culLevelDetail[k]=[];
  culLevelDetail[k].push(s.faction_creator || s.faction);
}
console.log('\ndescr_strat culture/level histogram:');
Object.entries(culLevelHist).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ', k, v));

// Now load save model coords
const savBuf = fs.readFileSync(SAV);
const BLOCK_START = 0x1f47809, BLOCK_END = 0x1f8f9bc;
const validNames = new Set(['Eastern_Town','Eastern_City','Eastern_Large_Town','Eastern_Huge_City',
  'Celtic_Town','Celtic_City','Celtic_Large_Town',
  'W_hellenistic_Town','W_hellenistic_City','W_hellenistic_Large_Town','W_hellenistic_Large_City','W_hellenistic_Huge_City',
  'Illyrian_Town','Illyrian_Large_Town',
  'Carthaginian_Town','Carthaginian_City','Carthaginian_Large_Town','Carthaginian_Huge_City',
  'Germanic_Town','Germanic_Large_Town',
  'Nomad_Town','Nomad_Large_Town',
  'Egyptian_Town','Egyptian_Large_Town']);
const setCoords = new Map();
let pos = BLOCK_START;
while(pos < BLOCK_END - 20){
  const lenP1 = savBuf.readUInt16LE(pos);
  if(lenP1 < 4 || lenP1 > 32){ pos++; continue; }
  const strLen = lenP1 - 1;
  if(pos+2+strLen+1 > savBuf.length){ pos++; continue; }
  const name = savBuf.slice(pos+2, pos+2+strLen).toString('ascii');
  if(!validNames.has(name) || savBuf[pos+2+strLen]!==0){ pos++; continue; }
  const headerEnd = pos+2+strLen+1;
  if(headerEnd+20 > savBuf.length){ pos++; continue; }
  const tag = savBuf.readUInt32LE(headerEnd);
  const X = savBuf.readUInt32LE(headerEnd+4);
  const Y = savBuf.readUInt32LE(headerEnd+8);
  if(tag===27||tag===29||tag===31){
    const k = X+'_'+Y;
    if(!setCoords.has(k)) setCoords.set(k, []);
    setCoords.get(k).push({name, tag});
    pos = headerEnd + 12;
    continue;
  }
  pos++;
}
console.log('\nSave distinct settlement coords:', setCoords.size);

// Build save culture/level histogram from tag=27 only (active render)
function modelCulture(m){
  if(m.startsWith('W_hellenistic_')) return 'roman';
  if(m.startsWith('Celtic_')) return 'barbarian';
  if(m.startsWith('Carthaginian_')) return 'carthaginian';
  if(m.startsWith('Illyrian_')) return 'barbarian';
  if(m.startsWith('Eastern_')) return 'eastern';
  if(m.startsWith('Germanic_')) return 'barbarian';
  if(m.startsWith('Nomad_')) return 'nomad';
  if(m.startsWith('Egyptian_')) return 'egyptian';
  return '?';
}
function modelLevel(m){
  return m.replace(/^[^_]+_(?:hellenistic_)?/, '');
}
const saveCulLevel = {};
for(const [coord, list] of setCoords){
  // For each tag, count by tag.
  // tag=27 (active) is the canonical "current state"
  const t27 = list.filter(x=>x.tag===27);
  for(const it of t27){
    const k = modelCulture(it.name)+'/'+modelLevel(it.name);
    saveCulLevel[k] = (saveCulLevel[k]||0)+1;
  }
}
console.log('\nSave (tag=27 only) culture/level histogram:');
Object.entries(saveCulLevel).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ', k, v));

// Comparison: total count by level
const dsLevelTot = {}, savLevelTot = {};
for(const [k,v] of Object.entries(culLevelHist)){
  const lvl = k.split('/')[1];
  dsLevelTot[lvl] = (dsLevelTot[lvl]||0)+v;
}
for(const [k,v] of Object.entries(saveCulLevel)){
  const lvl = k.split('/')[1];
  savLevelTot[lvl] = (savLevelTot[lvl]||0)+v;
}
console.log('\nTotals by level:');
console.log('  descr_strat:', dsLevelTot);
console.log('  save active:', savLevelTot);

// And totals by culture
const dsCultTot = {}, savCultTot = {};
for(const [k,v] of Object.entries(culLevelHist)){
  const cul = k.split('/')[0];
  dsCultTot[cul] = (dsCultTot[cul]||0)+v;
}
for(const [k,v] of Object.entries(saveCulLevel)){
  const cul = k.split('/')[0];
  savCultTot[cul] = (savCultTot[cul]||0)+v;
}
console.log('\nTotals by culture:');
console.log('  descr_strat:', dsCultTot);
console.log('  save active:', savCultTot);

// Now check: tag=27 = active render. Distinct coords with tag=27 = 131 (per earlier).
// Hmm but settlements in descr_strat = 1831. The save model block is missing
// most. Possibly the save model block contains only settlements visible to the
// player's faction (player = Romans Julii) — i.e. those in player's known regions?
// Let's count tag=27 coords by their X-pixel position to see if they're geographically clustered.
const xs = [], ys = [];
for(const [coord, list] of setCoords){
  if(list.some(x=>x.tag===27)){
    const [x,y] = coord.split('_').map(Number);
    xs.push(x); ys.push(y);
  }
}
xs.sort((a,b)=>a-b); ys.sort((a,b)=>a-b);
console.log('\nSave tag=27 coord X range:', xs[0], '..', xs[xs.length-1], 'mean:', (xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(1));
console.log('Save tag=27 coord Y range:', ys[0], '..', ys[ys.length-1], 'mean:', (ys.reduce((a,b)=>a+b,0)/ys.length).toFixed(1));
// X centred around ~390 = Mediterranean. Y around 360 = mid map. So yes, mostly Mediterranean.

// All save coords (tag=27,29,31)
console.log('\nAll save model coords:', setCoords.size);
const allX = [], allY = [];
for(const c of setCoords.keys()){
  const [x,y] = c.split('_').map(Number);
  allX.push(x); allY.push(y);
}
allX.sort((a,b)=>a-b); allY.sort((a,b)=>a-b);
console.log('X range:', allX[0], '..', allX[allX.length-1]);
console.log('Y range:', allY[0], '..', allY[allY.length-1]);
