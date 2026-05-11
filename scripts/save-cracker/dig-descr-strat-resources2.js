// Session 25 / Target 1 — Y-flip corrected
// descr_strat uses Y=0 south (bottom-up). TGA / save uses Y=0 top.
//   tga_y = 699 - descr_y.
//
// Cross-tab the 697 non-canonical mid-file cells against:
//   - resource (X,Y) entries — does ANY enrichment hold per type?
//   - character (X,Y) entries (generals/agents)
//   - settlement model coords (from session 24 block — already in TGA px space)

const fs = require('fs');

const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const DS  = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data/original_overrides/resource_quantity/world/maps/campaign/imperial_campaign/descr_strat.txt';

const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;
const TGA_W = 1020, TGA_H = 700;
const PX_PER_CELL_X = TGA_W / W;   // 4.25
const PX_PER_CELL_Y = TGA_H / H;   // 2.941

function parseDescrStrat() {
  const t = fs.readFileSync(DS,'utf8');
  const lines = t.split(/\r?\n/);
  const resources = [];
  const characters = [];
  const CTYPES = new Set(['named_character','general','admiral','diplomat','spy','assassin','priest']);
  let currentFaction = null;
  for(let i=0;i<lines.length;i++){
    const raw = lines[i];
    const l = raw.replace(/;.*$/,'').trim();
    if(!l) continue;
    let m = l.match(/^faction\s+(\w+)\s*,/i);
    if(m){ currentFaction = m[1]; continue; }
    m = l.match(/^resource\s+(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/);
    if(m){
      resources.push({type:m[1], quant:parseInt(m[2]), x:parseInt(m[3]), y:parseInt(m[4])});
      continue;
    }
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
  return {resources, characters};
}

function loadMidfileCells() {
  const buf = fs.readFileSync(SAV);
  const cells = [];
  const noncanon = [];
  for(let r=0;r<H;r++){
    for(let c=0;c<W;c++){
      const off = ARR_START + (r*W + c) * STRIDE;
      if(off+33 > buf.length) continue;
      const f16 = buf.readUInt32LE(off+16);
      const f20 = buf.readUInt32LE(off+20);
      const f24 = buf.readUInt32LE(off+24);
      const f28 = buf.readUInt32LE(off+28);
      const f32 = buf.readUInt32LE(off+32);
      const isBorderSentinel = (c===239 || r===237 || (c+r)===237);
      cells.push({r,c,f16,f20,f24,f28,f32,isBorderSentinel});
      const canonical = (f16===200 && f20===200 && f24===2 && f28===6 && f32===200);
      if(!canonical && !isBorderSentinel) noncanon.push({r,c,f16,f20,f24,f28,f32});
    }
  }
  return {cells, noncanon};
}

// descrXY → (row,col) cell index in mid-file grid
function descrToCell(descrX, descrY) {
  // Y-flip: tga_y = 699 - descrY
  const tgaY = (TGA_H - 1) - descrY;
  const c = Math.floor(descrX / PX_PER_CELL_X);
  const r = Math.floor(tgaY / PX_PER_CELL_Y);
  if(c<0||c>=W||r<0||r>=H) return null;
  return {r,c};
}

const {resources, characters} = parseDescrStrat();
const {cells, noncanon} = loadMidfileCells();
const noncanonKeys = new Set(noncanon.map(n=>`${n.r}_${n.c}`));
const interior = cells.filter(c=>!c.isBorderSentinel);
const interiorTotal = interior.length;
console.log('Interior cells:', interiorTotal, 'non-canon:', noncanon.length, 'baseline rate:', (100*noncanon.length/interiorTotal).toFixed(3)+'%');

function overlap(label, entries) {
  let inCanon=0, inNoncanon=0, inSentinel=0, outOfGrid=0;
  for(const p of entries){
    const cell = descrToCell(p.x,p.y);
    if(!cell){ outOfGrid++; continue; }
    const k=`${cell.r}_${cell.c}`;
    if(noncanonKeys.has(k)){ inNoncanon++; continue; }
    // is it a sentinel?
    const interiorCell = interior.find(ic=>ic.r===cell.r&&ic.c===cell.c);
    if(!interiorCell){ inSentinel++; continue; }
    inCanon++;
  }
  const inInterior = inCanon + inNoncanon;
  const expected = (noncanon.length / interiorTotal) * inInterior;
  const ratio = inNoncanon / (expected || 1);
  console.log(`\n${label}: total=${entries.length}, out=${outOfGrid}, sentinel=${inSentinel}, canon=${inCanon}, noncanon=${inNoncanon}, exp=${expected.toFixed(2)}, enrichment=${ratio.toFixed(2)}x`);
  return {inCanon, inNoncanon, expected, ratio};
}

overlap('Resources (Y-flipped)', resources.filter(r=>r.x!==null));

// per-type
console.log('\n--- Per-resource-type non-canon enrichment (Y-flipped) ---');
const perType = {};
for(const r of resources){
  if(r.x===null) continue;
  const cell = descrToCell(r.x,r.y);
  if(!cell) continue;
  const k = `${cell.r}_${cell.c}`;
  const interiorCell = interior.find(ic=>ic.r===cell.r&&ic.c===cell.c);
  if(!interiorCell) continue; // skip sentinel
  if(!perType[r.type]) perType[r.type] = {total:0, noncanon:0};
  perType[r.type].total++;
  if(noncanonKeys.has(k)) perType[r.type].noncanon++;
}
const baselineRatio = noncanon.length / interiorTotal;
const rows = Object.entries(perType).map(([t,v])=>{
  const expected = baselineRatio * v.total;
  return {type:t, total:v.total, noncanon:v.noncanon, expected:expected.toFixed(2), enrichment:(v.noncanon/(expected||1)).toFixed(2)+'x'};
});
rows.sort((a,b)=>parseFloat(b.enrichment)-parseFloat(a.enrichment));
console.table(rows);

// characters by type
const charTypes = [...new Set(characters.map(c=>c.type))];
for(const t of charTypes){
  overlap(`Characters[${t}]`, characters.filter(c=>c.type===t && c.x!==null));
}

// Settlement coords from session 24 — extract from save's settlement-model block at 0x1f47809
console.log('\n--- Settlement-model block coords vs non-canon ---');
const buf = fs.readFileSync(SAV);
const BLOCK_START = 0x1f47809, BLOCK_END = 0x1f8f9bc;
const setCoords = new Map();
let pos = BLOCK_START;
const validNames = new Set(['Eastern_Town','Eastern_City','Eastern_Large_Town','Eastern_Huge_City',
  'Celtic_Town','Celtic_City','Celtic_Large_Town',
  'W_hellenistic_Town','W_hellenistic_City','W_hellenistic_Large_Town','W_hellenistic_Large_City','W_hellenistic_Huge_City',
  'Illyrian_Town','Illyrian_Large_Town',
  'Carthaginian_Town','Carthaginian_City','Carthaginian_Large_Town','Carthaginian_Huge_City',
  'Germanic_Town','Germanic_Large_Town',
  'Nomad_Town','Nomad_Large_Town',
  'Egyptian_Town','Egyptian_Large_Town']);
while(pos < BLOCK_END - 20){
  const lenPlus1 = buf.readUInt16LE(pos);
  if(lenPlus1 < 4 || lenPlus1 > 32){ pos++; continue; }
  const strLen = lenPlus1 - 1;
  if(pos+2+strLen+1 > buf.length){ pos++; continue; }
  const name = buf.slice(pos+2, pos+2+strLen).toString('ascii');
  if(!validNames.has(name) || buf[pos+2+strLen]!==0){ pos++; continue; }
  const headerEnd = pos+2+strLen+1;
  if(headerEnd+20 > buf.length){ pos++; continue; }
  const tag = buf.readUInt32LE(headerEnd);
  const X = buf.readUInt32LE(headerEnd+4);
  const Y = buf.readUInt32LE(headerEnd+8);
  if(tag===27||tag===29||tag===31){
    setCoords.set(`${X}_${Y}`,(setCoords.get(`${X}_${Y}`)||0)+1);
    pos = headerEnd + 12;
    continue;
  }
  pos++;
}
console.log('distinct settlement coords found:', setCoords.size);
// settlement coords are TGA pixel space already (X[83..988], Y[22..651])
// Map each to a cell, check non-canon enrichment
function tgaToCell(tx,ty){
  const c = Math.floor(tx / PX_PER_CELL_X);
  const r = Math.floor(ty / PX_PER_CELL_Y);
  if(c<0||c>=W||r<0||r>=H) return null;
  return {r,c};
}
let setIn={canon:0,noncanon:0,sentinel:0,out:0};
for(const k of setCoords.keys()){
  const [tx,ty]=k.split('_').map(Number);
  const cell=tgaToCell(tx,ty);
  if(!cell){ setIn.out++; continue; }
  const ck=`${cell.r}_${cell.c}`;
  if(noncanonKeys.has(ck)){ setIn.noncanon++; continue; }
  const ic = interior.find(c=>c.r===cell.r&&c.c===cell.c);
  if(!ic){ setIn.sentinel++; continue; }
  setIn.canon++;
}
console.log('settlement coords → canon='+setIn.canon, 'noncanon='+setIn.noncanon, 'sentinel='+setIn.sentinel, 'out='+setIn.out);
// expected
const setInterior = setIn.canon + setIn.noncanon;
console.log('settlement non-canon expected (random):', (baselineRatio*setInterior).toFixed(2), 'actual:', setIn.noncanon);

// Also sanity-check: does resource location land near settlement coords?
// (Quick test on amber Baltic to confirm Y-flip is right)
const amber = resources.filter(r=>r.type==='amber' && r.x!==null);
console.log('\nAmber after Y-flip (tga_y):');
for(const a of amber.slice(0,5)){
  const ty = (TGA_H-1)-a.y;
  console.log(' descr(',a.x,',',a.y,') → tga(',a.x,',',ty,')');
}
const incense = resources.filter(r=>r.type==='incense' && r.x!==null);
console.log('\nIncense after Y-flip (tga_y):');
for(const a of incense.slice(0,5)){
  const ty = (TGA_H-1)-a.y;
  console.log(' descr(',a.x,',',a.y,') → tga(',a.x,',',ty,')');
}
