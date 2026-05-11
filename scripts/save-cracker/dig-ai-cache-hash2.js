// dig-ai-cache-hash2.js — cross-validate AI cache hash = per-character identifier.
// Track a single hash across multiple Alexander saves. If a character dies between
// T_n and T_n+1, its hash should disappear.

const fs = require('fs');
const ALEX_DIR = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';

const FILES = {
  t1e:  '0014_save_Autosave   Macedon   Turn 1 End.sav',
  t2e:  '0028_save_Autosave   Macedon   Turn 2 End.sav',
  t3e:  '0042_save_Autosave   Macedon   Turn 3 End.sav',
  t5s:  '0063_save_Autosave   Macedon   Turn 5 Start.sav',
  t11s: '0161_save_Autosave   Macedon   Turn 11 Start.sav',
  t11e: '0169_save_Autosave   Macedon   Turn 11 End.sav',
  t13s: '0351_save_Autosave   Macedon   Turn 13 Start.sav',
  t13e: '0357_save_Autosave   Macedon   Turn 13 End.sav',
  t14e: '0369_save_Autosave   Macedon   Turn 14 End.sav',
  t15e: '0381_save_Autosave   Macedon   Turn 15 End.sav',
};
const bufs = {};
for(const [k, f] of Object.entries(FILES)) bufs[k] = fs.readFileSync(ALEX_DIR + f);

function walk(buf, start=0x1024){
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(c >= 300) return recs;
    recs.push({a,b,c, x: (b>>>16)&0xff, y: c});
  }
  return recs;
}

const allHashes = {};
for(const [k, b] of Object.entries(bufs)){
  const recs = walk(b);
  const hashSet = new Set();
  for(const r of recs) if(r.a !== 0) hashSet.add(r.a);
  allHashes[k] = hashSet;
  console.log(k+': '+recs.length+' records, '+hashSet.size+' distinct non-zero hashes');
}

// Set diffs between consecutive saves
function setDiff(a, b){
  const onlyA = [...a].filter(x=>!b.has(x));
  const onlyB = [...b].filter(x=>!a.has(x));
  return {removed: onlyA, added: onlyB, common: [...a].filter(x=>b.has(x)).length};
}
console.log('\nHash set differences between consecutive saves:');
const keys = Object.keys(allHashes);
for(let i=0;i<keys.length-1;i++){
  const k1 = keys[i], k2 = keys[i+1];
  const d = setDiff(allHashes[k1], allHashes[k2]);
  console.log('  '+k1+' → '+k2+': removed '+d.removed.length+', added '+d.added.length+', common '+d.common);
  if(d.removed.length > 0 && d.removed.length < 5){
    console.log('    Removed: '+d.removed.map(h=>'0x'+h.toString(16).padStart(8,'0')).join(', '));
  }
  if(d.added.length > 0 && d.added.length < 5){
    console.log('    Added: '+d.added.map(h=>'0x'+h.toString(16).padStart(8,'0')).join(', '));
  }
}

// All hashes that persist across all saves
let universal = new Set([...allHashes[keys[0]]]);
for(let i=1;i<keys.length;i++){
  const u = new Set();
  for(const h of universal) if(allHashes[keys[i]].has(h)) u.add(h);
  universal = u;
}
console.log('\nUniversal hashes (in all 10 saves):', universal.size);
console.log('  '+[...universal].slice(0,10).map(h=>'0x'+h.toString(16).padStart(8,'0')).join(', '));

// Track one hash across all saves
const trackHash = 0x8259699d; // The Macedon homeland hash
console.log('\nTracking hash 0x8259699d (Macedon homeland) across saves:');
for(const [k, b] of Object.entries(bufs)){
  const recs = walk(b);
  const matched = recs.filter(r => r.a === trackHash);
  if(matched.length === 0){ console.log('  '+k+': (none)'); continue; }
  const xs = matched.map(r=>r.x);
  const ys = matched.map(r=>r.y);
  console.log('  '+k+': '+matched.length+' records, X range '+Math.min(...xs)+'..'+Math.max(...xs)+', Y range '+Math.min(...ys)+'..'+Math.max(...ys));
}

// Track which hashes have records appearing for the FIRST time across the corpus
console.log('\nNew hashes by save (showing first 3 added per transition):');
let known = new Set();
for(const k of keys){
  const novel = [];
  for(const h of allHashes[k]) if(!known.has(h)) novel.push(h);
  for(const h of allHashes[k]) known.add(h);
  console.log('  '+k+': '+novel.length+' new hashes');
}
