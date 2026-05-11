// Task 3: Validate agent records via descr_strat
// descr_strat declares agent characters (spies/diplomats/etc) under 'character TYPE, name'.
// Verify whether the save's character records include them.

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
    let x=null,y=null;
    for(const f of fields){
      let mx=f.match(/^x\s+(-?\d+)$/); if(mx) x=parseInt(mx[1]);
      let my=f.match(/^y\s+(-?\d+)$/); if(my) y=parseInt(my[1]);
    }
    characters.push({type,name,faction:currentFaction,x,y});
  }
}

const typeCounts = {};
for(const c of characters) typeCounts[c.type]=(typeCounts[c.type]||0)+1;
console.log('=== descr_strat character types ===');
Object.entries(typeCounts).forEach(([t,c])=>console.log(' ', t, c));

const AGENT = new Set(['diplomat','spy','assassin','priest','admiral']);
const agents = characters.filter(c=>AGENT.has(c.type));
console.log('\nAgent characters in descr_strat:', agents.length);

const allAgentNames = new Set(agents.map(a=>a.name));
console.log('Unique agent names:', allAgentNames.size);

let foundUtf16 = 0, foundAscii = 0;
const foundAt = {};
for(const name of allAgentNames){
  const u16 = Buffer.from(name, 'utf16le');
  const ascii = Buffer.from(name, 'ascii');
  const i16 = buf.indexOf(u16);
  const ia  = buf.indexOf(ascii);
  if(i16 >= 0){ foundUtf16++; foundAt[name]={u16:i16, ascii:ia}; }
  else if(ia >= 0){ foundAscii++; foundAt[name]={u16:i16, ascii:ia}; }
}
console.log('Agent names found in save (UTF-16LE):', foundUtf16, '/', allAgentNames.size);
console.log('Agent names found in save (ASCII only):', foundAscii);
console.log('Agent names NOT found:', allAgentNames.size - foundUtf16 - foundAscii);

const notFound = [...allAgentNames].filter(n=>!foundAt[n] || (foundAt[n].u16<0 && foundAt[n].ascii<0));
console.log('\nSample NOT FOUND agent names:');
notFound.slice(0,15).forEach(n=>console.log('  '+n));

// === Compare with generals ===
const generals = characters.filter(c=>c.type==='general');
const namedChars = characters.filter(c=>c.type==='named_character');
console.log('\nGenerals (descr_strat):', generals.length, ' named_character:', namedChars.length);

let genFoundU16=0;
const genNames = new Set(generals.map(g=>g.name));
for(const n of genNames){
  if(buf.indexOf(Buffer.from(n,'utf16le')) >= 0) genFoundU16++;
}
console.log('General names found in UTF-16LE:', genFoundU16, '/', genNames.size);

let ncFoundU16=0;
const ncNames = new Set(namedChars.map(g=>g.name));
for(const n of ncNames){
  if(buf.indexOf(Buffer.from(n,'utf16le')) >= 0) ncFoundU16++;
}
console.log('named_character names found in UTF-16LE:', ncFoundU16, '/', ncNames.size);

// === Cluster analysis: where do agent name occurrences cluster? ===
const agentOffsets = [];
for(const a of agents){
  const u16 = Buffer.from(a.name, 'utf16le');
  let start = 0;
  while(true){
    const idx = buf.indexOf(u16, start);
    if(idx < 0) break;
    agentOffsets.push({off: idx, name: a.name, type: a.type, faction: a.faction});
    start = idx + 1;
  }
}
console.log('\nTotal agent UTF-16LE name occurrences:', agentOffsets.length);

const bin = {};
for(const o of agentOffsets){
  const b = Math.floor(o.off / 0x10000);
  bin[b]=(bin[b]||0)+1;
}
const top = Object.entries(bin).sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log('Top 64KB bins by agent-name occurrence:');
top.forEach(([b,c])=>console.log('  bin 0x'+(b*0x10000).toString(16)+'..0x'+((parseInt(b)+1)*0x10000).toString(16)+': '+c+' hits'));

// Also check: are there agent name occurrences specifically in the body root
// region but OUTSIDE character_paths kid[0] (the UUID index)?
const BODY = {start: 0x3b99, end: 0x633bb3};
const inBody = agentOffsets.filter(o=>o.off >= BODY.start && o.off < BODY.end);
const KID0 = {start: 0x51ad, end: 0x87e9};
const inKid0 = inBody.filter(o=>o.off >= KID0.start && o.off < KID0.end);
const inGapBetween = inBody.filter(o=>o.off >= 0x87e9 && o.off < 0xa8beb);
const inAfter = inBody.filter(o=>o.off >= 0xa8beb);
console.log('Agent name occurrences in body root:', inBody.length);
console.log('  in kid[0] (char-id index):', inKid0.length);
console.log('  in gap-B/C (events/year-log):', inGapBetween.length);
console.log('  after gap-C (in kids 1+):', inAfter.length);

// Settlement zone is ~0xf88637..0x1f10c72 per session 12.
// But for rome10 RIS the settlement-model block is 0x1f47809..0x1f8f9bc.
// We see agents at varying offsets — let me check if any are in the settlement zone.
const SETTLEMENT = {start: 0xf88637, end: 0x1f47809}; // before model block
const inSettlement = agentOffsets.filter(o=>o.off >= SETTLEMENT.start && o.off < SETTLEMENT.end);
console.log('Agent name occurrences in settlement zone:', inSettlement.length);

// Sample distinct agents and where they appear
console.log('\nSample 10 agents and their location:');
const sample = [...allAgentNames].slice(0,10);
for(const n of sample){
  const occ = agentOffsets.filter(o=>o.name===n);
  console.log('  '+n+' x'+occ.length, occ.slice(0,5).map(o=>'0x'+o.off.toString(16)).join(', '));
}
