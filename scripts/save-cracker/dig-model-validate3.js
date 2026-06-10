// Final validation: use cached faction→culture map
const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const DS  = 'C:/RIS/RIS/data/original_overrides/resource_quantity/world/maps/campaign/imperial_campaign/descr_strat.txt';
const FC  = 'C:/dev/Provincia/scripts/save-cracker/faction_culture_cache.json';

const fc = JSON.parse(fs.readFileSync(FC,'utf8'));

const t = fs.readFileSync(DS,'utf8');
const lines = t.split(/\r?\n/);
const settlements = [];
let currentFaction = null;
let inSet = false, buf = null;
for(let i=0;i<lines.length;i++){
  const raw = lines[i];
  const l = raw.replace(/;.*$/,'').trim();
  let mm = l.match(/^faction\s+(\w+)\s*,/i);
  if(mm){ currentFaction = mm[1]; continue; }
  if(l === 'settlement'){ inSet=true; buf={faction:currentFaction}; continue; }
  if(!inSet) continue;
  const lvl = l.match(/^level\s+(\w+)/);
  if(lvl){ buf.level = lvl[1]; continue; }
  const fcm = l.match(/^faction_creator\s+(\w+)/);
  if(fcm){ buf.faction_creator = fcm[1]; continue; }
  if(l === '}'){ settlements.push(buf); inSet=false; buf=null; }
}

// Apply culture
const dsCL = {};
for(const s of settlements){
  if(!s) continue;
  const c = fc[s.faction_creator] || fc[s.faction] || '?';
  const k = c + '/' + (s.level||'?');
  dsCL[k] = (dsCL[k]||0)+1;
}
console.log('=== descr_strat (culture/level) ===');
Object.entries(dsCL).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ', k, v));

// Totals by level
const dsByLevel = {};
const dsByCulture = {};
for(const [k,v] of Object.entries(dsCL)){
  const [c,l] = k.split('/');
  dsByLevel[l] = (dsByLevel[l]||0)+v;
  dsByCulture[c] = (dsByCulture[c]||0)+v;
}
console.log('descr_strat totals by level:', dsByLevel);
console.log('descr_strat totals by culture:', dsByCulture);

// === Save model block ===
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

const records = [];
let pos = BLOCK_START;
while(pos < BLOCK_END - 20){
  const lenP1 = savBuf.readUInt16LE(pos);
  if(lenP1 < 4 || lenP1 > 32){ pos++; continue; }
  const strLen = lenP1 - 1;
  if(pos+2+strLen+1 > savBuf.length){ pos++; continue; }
  const name = savBuf.slice(pos+2, pos+2+strLen).toString('ascii');
  if(!validNames.has(name) || savBuf[pos+2+strLen]!==0){ pos++; continue; }
  const headerEnd = pos+2+strLen+1;
  const tag = savBuf.readUInt32LE(headerEnd);
  const X = savBuf.readUInt32LE(headerEnd+4);
  const Y = savBuf.readUInt32LE(headerEnd+8);
  if(tag===27||tag===29||tag===31){
    records.push({off:pos,name,tag,X,Y});
    pos = headerEnd + 12;
    continue;
  }
  pos++;
}
console.log('\nSave records found:', records.length);
console.log('By tag:', {27: records.filter(r=>r.tag===27).length, 29: records.filter(r=>r.tag===29).length, 31: records.filter(r=>r.tag===31).length});

function mc(m){
  if(m.startsWith('W_hellenistic_')) return 'roman';
  if(m.startsWith('Celtic_')||m.startsWith('Illyrian_')||m.startsWith('Germanic_')) return 'barbarian';
  if(m.startsWith('Carthaginian_')) return 'carthaginian';
  if(m.startsWith('Eastern_')) return 'eastern';
  if(m.startsWith('Nomad_')) return 'nomad';
  if(m.startsWith('Egyptian_')) return 'egyptian';
  return '?';
}
function ml(m){
  // model_to_level: extract suffix
  if(m.endsWith('Huge_City')) return 'huge_city';
  if(m.endsWith('Large_City')) return 'large_city';
  if(m.endsWith('Large_Town')) return 'large_town';
  if(m.endsWith('City')) return 'city';
  if(m.endsWith('Town')) return 'town';
  return '?';
}

// tag=27 only (active)
const t27 = records.filter(r=>r.tag===27);
const saveCL = {};
for(const r of t27){
  const c = mc(r.name), l = ml(r.name);
  saveCL[c+'/'+l] = (saveCL[c+'/'+l]||0)+1;
}
console.log('\nSave (tag=27) culture/level:');
Object.entries(saveCL).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ', k, v));

const savByLevel = {};
const savByCulture = {};
for(const [k,v] of Object.entries(saveCL)){
  const [c,l] = k.split('/');
  savByLevel[l] = (savByLevel[l]||0)+v;
  savByCulture[c] = (savByCulture[c]||0)+v;
}
console.log('save totals by level:', savByLevel);
console.log('save totals by culture:', savByCulture);

// === KEY ANALYSIS: where does the mismatch come from? ===
// descr_strat has 1831 settlements; save tag=27 has only ~410.
// Hypothesis: save only has settlements that have BEEN RENDERED (i.e. visible
// at some point to the player). The other 1400 are still unexplored.
// Test: are the 410 settlements with tag=27 geographically clustered around Italy?

// Distance from Roma (296, 380) per descr_strat
const ROMA_X = 296, ROMA_Y_DESCR = 380; // need to convert
// settlement coords in save model block are in some space. Let me check:
const xs = t27.map(r=>r.X).sort((a,b)=>a-b);
const ys = t27.map(r=>r.Y).sort((a,b)=>a-b);
console.log('\nSave tag=27 coords:');
console.log('  X p25/p50/p75:', xs[Math.floor(xs.length*0.25)], xs[Math.floor(xs.length*0.5)], xs[Math.floor(xs.length*0.75)]);
console.log('  Y p25/p50/p75:', ys[Math.floor(ys.length*0.25)], ys[Math.floor(ys.length*0.5)], ys[Math.floor(ys.length*0.75)]);

// Important: tag=29 and tag=31 might be the OTHER settlements (less prominent).
const allCoords = new Set(records.map(r=>r.X+'_'+r.Y));
console.log('\nDistinct settlement coords in save model block:', allCoords.size);
console.log('descr_strat settlements:', settlements.length);
console.log('Coverage ratio:', (100*allCoords.size/settlements.length).toFixed(1)+'%');

// Per-culture coverage check: maybe the save only renders some cultures?
// dsByCulture['barbarian'] vs savByCulture['barbarian'] etc.
console.log('\nPer-culture coverage:');
const cultures = new Set([...Object.keys(dsByCulture), ...Object.keys(savByCulture)]);
for(const c of cultures){
  const ds = dsByCulture[c]||0;
  const sv = savByCulture[c]||0;
  const pct = ds>0 ? (100*sv/ds).toFixed(1)+'%' : 'n/a';
  console.log('  '+c+': descr_strat='+ds+', save='+sv+', coverage='+pct);
}
