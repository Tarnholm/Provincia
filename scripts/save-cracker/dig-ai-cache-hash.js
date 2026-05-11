// dig-ai-cache-hash.js — session 19: hash semantics. Tile coords are CONFIRMED
// to be byte2 of key and turn-field. Hash is 32-bit. Test hypotheses:
//   (a) CRC32 of character name/internal_name
//   (b) CRC32 of "faction_name"
//   (c) Some other identifier

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
    recs.push({a,b,c,off, x:(b>>>16)&0xff, y:c});
  }
  return recs;
}

const recs = walk(t13e);
// Group by hash
const byHash = new Map();
for(const r of recs){
  if(r.a === 0) continue;
  if(!byHash.has(r.a)) byHash.set(r.a, []);
  byHash.get(r.a).push(r);
}

// For each hash, compute centroid (x, y)
const hashCentroids = [];
for(const [h, hrecs] of byHash.entries()){
  const xs = hrecs.map(r=>r.x);
  const ys = hrecs.map(r=>r.y);
  const cx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const cy = ys.reduce((a,b)=>a+b,0)/ys.length;
  hashCentroids.push({h, count: hrecs.length, cx, cy, xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys)});
}
hashCentroids.sort((a,b)=>b.count-a.count);

// Read descr_strat to get character positions
const stratPath = 'C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/alexander/data/world/maps/campaign/alexander/descr_strat.txt';
const strat = fs.readFileSync(stratPath, 'latin1');
const lines = strat.split('\n');

// Extract characters with positions
const chars = [];
let currentFaction = null;
for(const line of lines){
  const fm = line.match(/^faction\s+([a-z_]+)/);
  if(fm) currentFaction = fm[1];
  const m = line.match(/^character\s+([^,]+),\s*([a-z_ ]+),\s*(?:.*?)x\s+(\d+),\s*y\s+(\d+)/);
  if(m){
    chars.push({name: m[1].trim(), type: m[2].trim(), faction: currentFaction, x: +m[3], y: +m[4]});
  }
}
console.log('Total characters with positions:', chars.length);

// Hash candidate analysis: compute "crc32-like" simple hashes of character names
function crc32(str){
  let crc = 0xffffffff;
  for(let i=0;i<str.length;i++){
    crc ^= str.charCodeAt(i);
    for(let j=0;j<8;j++){
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Test: for each top hash, find characters near (cx, cy) and check if their CRC32 matches
console.log('\nTop hashes & nearby characters from descr_strat:');
for(const hc of hashCentroids.slice(0, 15)){
  console.log('\nhash=0x'+hc.h.toString(16).padStart(8,'0')+' count='+hc.count+' centroid=('+hc.cx.toFixed(1)+','+hc.cy.toFixed(1)+') box=('+hc.xmin+'..'+hc.xmax+', '+hc.ymin+'..'+hc.ymax+')');
  // Find chars within 5 tiles of centroid
  const nearby = chars.filter(c => Math.abs(c.x - hc.cx) <= 8 && Math.abs(c.y - hc.cy) <= 8);
  for(const c of nearby.slice(0, 8)){
    const fullName = c.name+' '+c.faction;
    const crc = crc32(c.name);
    const crcF = crc32(c.name+'_'+c.faction);
    const match = (crc === hc.h || crcF === hc.h) ? ' ★MATCH★' : '';
    console.log('  '+c.faction+' '+c.type+' "'+c.name+'" at ('+c.x+','+c.y+')  crc32(name)=0x'+crc.toString(16).padStart(8,'0')+match);
  }
}

// Also check: do any character hashes match exactly?
console.log('\n\nFull CRC32 scan across all characters:');
let totalMatches = 0;
const hashSet = new Set(hashCentroids.map(hc => hc.h));
for(const c of chars){
  const crc = crc32(c.name);
  if(hashSet.has(crc)){
    console.log('  MATCH: '+c.faction+' '+c.type+' "'+c.name+'" → 0x'+crc.toString(16));
    totalMatches++;
  }
  const crc2 = crc32(c.name.replace(/\s+/g, '_'));
  if(hashSet.has(crc2)){
    console.log('  MATCH(_): "'+c.name+'" → 0x'+crc2.toString(16));
    totalMatches++;
  }
}
console.log('Total CRC32(name) matches:', totalMatches);

// Test alternate hash: simple string sum, etc.
// Also test: maybe hash is just an internal pointer / index, not a string hash
// We see 47 distinct hashes — exactly the # of factions? Or # of regions?
console.log('\n\nDistinct hashes:', hashCentroids.length);
const factions = new Set(chars.map(c=>c.faction));
console.log('Total factions in descr_strat:', factions.size);
console.log('Faction list:', [...factions].join(','));
