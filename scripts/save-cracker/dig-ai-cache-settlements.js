// dig-ai-cache-settlements.js — match hash centroids against settlement positions.
const fs = require('fs');
const ALEX_DIR = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const t13e = fs.readFileSync(ALEX_DIR + '0357_save_Autosave   Macedon   Turn 13 End.sav');

function walk(buf, start=0x1024){
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(c >= 300) return recs;
    recs.push({a,b,c, x:(b>>>16)&0xff, y:c});
  }
  return recs;
}
const recs = walk(t13e);
const byHash = new Map();
for(const r of recs){
  if(r.a === 0) continue;
  if(!byHash.has(r.a)) byHash.set(r.a, []);
  byHash.get(r.a).push(r);
}

// Parse settlements from descr_strat — walk by faction-block and find "settlement{ ... level townX ... x N, y N"
const stratPath = 'C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/alexander/data/world/maps/campaign/alexander/descr_strat.txt';
const strat = fs.readFileSync(stratPath, 'latin1');
const settlements = [];
{
  const re = /settlement\s+\{[^}]*?level\s+([a-z_]+)[\s\S]*?x\s+(\d+),\s*y\s+(\d+)/g;
  let m;
  while((m = re.exec(strat))) {
    settlements.push({level: m[1], x: +m[2], y: +m[3]});
  }
}
console.log('Settlements:', settlements.length);
// Also get character positions
const chars = [];
{
  let currentFaction = null;
  for(const line of strat.split('\n')){
    const fm = line.match(/^faction\s+([a-z_]+)/);
    if(fm) currentFaction = fm[1];
    const m = line.match(/^character\s+([^,]+),\s*([a-z_ ]+),\s*(?:.*?)x\s+(\d+),\s*y\s+(\d+)/);
    if(m){
      chars.push({name: m[1].trim(), type: m[2].trim(), faction: currentFaction, x: +m[3], y: +m[4]});
    }
  }
}

// Compute centroid + match
const hashAnalysis = [];
for(const [h, hrecs] of byHash.entries()){
  const cx = hrecs.reduce((a,b)=>a+b.x,0)/hrecs.length;
  const cy = hrecs.reduce((a,b)=>a+b.y,0)/hrecs.length;
  // Find nearest settlement
  let nearestS = null, dS = 1e9;
  for(const s of settlements){
    const d = Math.sqrt((s.x-cx)**2+(s.y-cy)**2);
    if(d < dS) { dS = d; nearestS = s; }
  }
  // Find nearest character
  let nearestC = null, dC = 1e9;
  for(const c of chars){
    const d = Math.sqrt((c.x-cx)**2+(c.y-cy)**2);
    if(d < dC) { dC = d; nearestC = c; }
  }
  hashAnalysis.push({h, count: hrecs.length, cx, cy, nearestS, dS, nearestC, dC});
}
hashAnalysis.sort((a,b)=>b.count-a.count);

console.log('\nHash → nearest settlement/character:');
let exactSettleHits = 0;
let within3SettleHits = 0;
for(const ha of hashAnalysis){
  if(ha.dS <= 1) exactSettleHits++;
  if(ha.dS <= 3) within3SettleHits++;
  console.log('  hash=0x'+ha.h.toString(16).padStart(8,'0')+
    ' n='+ha.count.toString().padStart(2)+
    ' centroid=('+ha.cx.toFixed(0)+','+ha.cy.toFixed(0)+')'+
    ' nearestSettle@('+ha.nearestS.x+','+ha.nearestS.y+') level='+ha.nearestS.level+' d='+ha.dS.toFixed(1)+
    ' | nearestChar='+ha.nearestC.faction+'/'+ha.nearestC.type+' d='+ha.dC.toFixed(1));
}
console.log('\nExact-settle hits (d≤1):', exactSettleHits, '/', hashAnalysis.length);
console.log('Within-3 settle hits:', within3SettleHits, '/', hashAnalysis.length);

// Also: count hashes whose ALL points are within X tiles of one settlement
console.log('\nHashes whose ALL records cluster within 5 tiles of one settlement:');
let coreHits = 0;
for(const [h, hrecs] of byHash.entries()){
  for(const s of settlements){
    let allIn = true;
    for(const r of hrecs){
      if(Math.sqrt((r.x-s.x)**2+(r.y-s.y)**2) > 5) { allIn = false; break; }
    }
    if(allIn){
      coreHits++;
      break;
    }
  }
}
console.log('  Tight-cluster count:', coreHits);
