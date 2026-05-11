// Validate agent records: count agents per faction in descr_strat vs character_paths
// in the save (kid count = 287 per session 12).

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const DS  = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data/original_overrides/resource_quantity/world/maps/campaign/imperial_campaign/descr_strat.txt';

const buf = fs.readFileSync(SAV);
const t = fs.readFileSync(DS,'utf8');
const lines = t.split(/\r?\n/);

const characters = [];
const CTYPES = new Set(['named_character','general','admiral','diplomat','spy','assassin','priest']);
let currentFaction = null;
for(let i=0;i<lines.length;i++){
  const raw = lines[i];
  const l = raw.replace(/;.*$/,'').trim();
  if(!l) continue;
  let m = l.match(/^faction\s+(\w+)\s*,/i);
  if(m){ currentFaction = m[1]; continue; }
  m = l.match(/^character\s+(.+)$/);
  if(m){
    const fields = m[1].split(',').map(s=>s.trim());
    let name = fields[0];
    const sfMatch = name.match(/^sub_faction\s+(\S+)\s+(.+)$/);
    if(sfMatch){ name = sfMatch[2]; }
    let type = null;
    for(const f of fields.slice(1)){ if(CTYPES.has(f)){ type = f; break; } }
    if(!type) continue;
    characters.push({type,name,faction:currentFaction});
  }
}

// Counts per faction per type
const perFactionType = {};
for(const c of characters){
  if(!perFactionType[c.faction]) perFactionType[c.faction]={};
  perFactionType[c.faction][c.type] = (perFactionType[c.faction][c.type]||0)+1;
}

// Total per type
const totalType = {};
for(const c of characters) totalType[c.type]=(totalType[c.type]||0)+1;
console.log('=== descr_strat character totals (initial state) ===');
Object.entries(totalType).forEach(([t,c])=>console.log(' ', t, c));
console.log('Total characters:', characters.length);

// Sample factions
console.log('\nSample per-faction per-type counts (first 10 factions):');
const fNames = Object.keys(perFactionType).sort();
for(const f of fNames.slice(0,10)){
  console.log(' ', f, ':', perFactionType[f]);
}

// Now walk body root kids and count "real" character_paths children.
// Per session 12, body root has 287 direct CHARACTER_PATHS children in rome10.
// We confirmed kid[0] @0x51ad is the UUID INDEX (13884B), and kid[1]+ are paths.
// But the linear walk broke because kid[0] is followed by gap-B (12-byte records),
// not by kid[1]. The 287 number from session 12 must come from a different walk.
//
// Let me find all self-pointer + size sections starting AFTER gap-C ends:

const SCAN_START = 0xa8beb; // after scripted events
const SCAN_END = 0x633bb3;  // body root end

const recs = [];
let off = SCAN_START;
let prevOff = -1;
while(off < SCAN_END - 12){
  const sp = buf.readUInt32LE(off);
  if(sp === off){
    const sz = buf.readUInt32LE(off+4);
    if(sz>=20 && sz<0x800000 && off+sz <= SCAN_END+8){
      recs.push({off, sz});
      off += sz;
      continue;
    }
  }
  off++;
}
console.log('\nSections found after gap-C (linear walk):', recs.length);
console.log('First 5:');
recs.slice(0,5).forEach(r=>console.log('  @0x'+r.off.toString(16)+' size=0x'+r.sz.toString(16)));
console.log('Last 5:');
recs.slice(-5).forEach(r=>console.log('  @0x'+r.off.toString(16)+' size=0x'+r.sz.toString(16)));

// What's the end of the last section in body root?
const totalBytes = recs.reduce((a,b)=>a+b.sz,0);
console.log('Total bytes in walked sections:', totalBytes);
console.log('Of body root range:', SCAN_END-SCAN_START, '=', (100*totalBytes/(SCAN_END-SCAN_START)).toFixed(1)+'%');

// What's left after the last section?
const lastEnd = recs.length ? recs[recs.length-1].off + recs[recs.length-1].sz : SCAN_START;
console.log('Last section ends at 0x'+lastEnd.toString(16), 'body root ends at 0x'+SCAN_END.toString(16), 'gap='+(SCAN_END-lastEnd));

// Size distribution of these sections
const sizes = recs.map(r=>r.sz).sort((a,b)=>a-b);
console.log('\nSection size distribution (after gap-C):');
console.log(' min:', sizes[0], 'max:', sizes[sizes.length-1], 'median:', sizes[Math.floor(sizes.length/2)]);
console.log(' mean:', (sizes.reduce((a,b)=>a+b,0)/sizes.length).toFixed(1));
// histogram
const bins = {};
for(const s of sizes){
  let bin;
  if(s<100) bin='<100';
  else if(s<500) bin='100-500';
  else if(s<1000) bin='500-1K';
  else if(s<5000) bin='1K-5K';
  else if(s<50000) bin='5K-50K';
  else bin='>50K';
  bins[bin]=(bins[bin]||0)+1;
}
console.log('Size histogram:', bins);

// === Count characters in descr_strat by faction
console.log('\n=== Total descr_strat character counts per faction (top 20) ===');
const fTotals = {};
for(const c of characters){
  fTotals[c.faction] = (fTotals[c.faction]||0)+1;
}
const fTop = Object.entries(fTotals).sort((a,b)=>b[1]-a[1]);
console.log('Total factions with characters:', fTop.length);
console.log('Top 20:');
fTop.slice(0,20).forEach(([f,c])=>console.log('  '+f+': '+c));
console.log('Bottom 20:');
fTop.slice(-20).forEach(([f,c])=>console.log('  '+f+': '+c));

// expected total
console.log('\nTotal characters in descr_strat:', characters.length);
console.log('Body root section count (after gap-C):', recs.length);
console.log('Difference:', recs.length - characters.length, '(positive = save has more, e.g. spawn churn over turns)');

// The 287 from session 12 was via a different walk that included only some
// records. Let me see if there's a more discriminating signature: per session 12,
// each character_paths kid has shape: [u32 self][u32 size][u32 size-20][u32 count][u32 X][u32 Y]...
// Let's apply the size-20 test.
const charPaths = recs.filter(r=>{
  if(r.sz < 20) return false;
  const f1 = buf.readUInt32LE(r.off+8);
  return f1 === r.sz - 20;
});
console.log('\nSections matching CHARACTER_PATHS shape (+8 == size-20):', charPaths.length);
const sizesCP = charPaths.map(r=>r.sz);
console.log('Total bytes:', sizesCP.reduce((a,b)=>a+b,0), 'mean:', (sizesCP.reduce((a,b)=>a+b,0)/sizesCP.length).toFixed(1));
