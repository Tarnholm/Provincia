#!/usr/bin/env node
// Session 25 / Target 1
// Cross-reference the 697 mid-file non-canonical cells against
//   - resource entries (X,Y) from descr_strat.txt
//   - starting army character positions (X,Y) from descr_strat.txt
//   - settlement coords from session 24's settlement-model block

const fs = require('fs');
const path = require('path');

const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const DS  = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data/original_overrides/resource_quantity/world/maps/campaign/imperial_campaign/descr_strat.txt';

// Session 24's mid-file array bounds (confirmed):
//   ARR_START = 0xf8fd2, STRIDE = 267, W=240, H=238 -> 57120 cells
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;

// Session 24's confirmed pixel scale on a 1020x700 map_regions.tga:
//   cell_x_size = 1020/240 = 4.25 px
//   cell_y_size = 700/238  = 2.941 px
const PX_PER_CELL_X = 1020 / W;
const PX_PER_CELL_Y = 700  / H;

function parseDescrStrat() {
  const t = fs.readFileSync(DS,'utf8');
  const lines = t.split(/\r?\n/);
  const resources = []; // {type, x, y, comment}
  const characters = []; // {type, name, subFac, faction, x, y}
  const CTYPES = new Set(['named_character','general','admiral','diplomat','spy','assassin','priest']);
  let currentFaction = null;

  for(let i=0;i<lines.length;i++){
    const raw = lines[i];
    const l = raw.replace(/;.*$/,'').trim(); // strip comments for parsing
    if(!l) continue;

    // faction declaration
    let m = l.match(/^faction\s+(\w+)\s*,/i);
    if(m){ currentFaction = m[1]; continue; }

    // resource lines
    m = l.match(/^resource\s+(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/);
    if(m){
      // resource type, ?, X, Y
      const commentM = raw.match(/;\s*(.+)$/);
      resources.push({type:m[1], quant:parseInt(m[2]), x:parseInt(m[3]), y:parseInt(m[4]), region: commentM?commentM[1].trim():null});
      continue;
    }

    // character lines
    m = l.match(/^character\s+(.+)$/);
    if(m){
      const body = m[1];
      const fields = body.split(',').map(s=>s.trim());
      let name = fields[0];
      let subFac = null;
      const sfMatch = name.match(/^sub_faction\s+(\S+)\s+(.+)$/);
      if(sfMatch){ subFac = sfMatch[1]; name = sfMatch[2]; }
      let type = null;
      for(const f of fields.slice(1)){
        if(CTYPES.has(f)){ type = f; break; }
      }
      if(!type) continue;
      let x=null,y=null;
      for(const f of fields){
        let mx=f.match(/^x\s+(-?\d+)$/); if(mx) x=parseInt(mx[1]);
        let my=f.match(/^y\s+(-?\d+)$/); if(my) y=parseInt(my[1]);
      }
      characters.push({type,name,subFac,faction:currentFaction,x,y});
      continue;
    }
  }

  return {resources, characters};
}

// Extract the 697 non-canonical cells from the save's mid-file array
function loadMidfileCells() {
  const buf = fs.readFileSync(SAV);
  // canonical pattern (per session 18/24): f16=200 f20=200 f24=2 f28=6 f32=200
  // Reading the same way as dig-midfile-aizone scripts.
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
      // skip border sentinels per session 22:
      //   column 239 (rightmost), row 237 (bottom), anti-diagonal c+r===237
      const isBorderSentinel = (c===239 || r===237 || (c+r)===237);
      cells.push({r,c,f16,f20,f24,f28,f32,isBorderSentinel});
      const canonical = (f16===200 && f20===200 && f24===2 && f28===6 && f32===200);
      if(!canonical && !isBorderSentinel) noncanon.push({r,c,f16,f20,f24,f28,f32});
    }
  }
  return {cells, noncanon};
}

const {resources, characters} = parseDescrStrat();
console.log('Resources parsed:', resources.length);
console.log('Resource type histogram:');
const rt = {}; resources.forEach(r=>{rt[r.type]=(rt[r.type]||0)+1;});
Object.entries(rt).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(' ', k, v));
console.log('Characters parsed:', characters.length);
console.log('Character type histogram:');
const ct = {}; characters.forEach(c=>{ct[c.type]=(ct[c.type]||0)+1;});
Object.entries(ct).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(' ', k, v));

const {cells, noncanon} = loadMidfileCells();
console.log('\nTotal cells:', cells.length);
console.log('Non-canonical cells:', noncanon.length);

// Build cell index -> set of cells that ANY resource (X,Y) maps into
function pxToCell(x,y){
  const c = Math.floor(x / PX_PER_CELL_X);
  const r = Math.floor(y / PX_PER_CELL_Y);
  if(c<0||c>=W||r<0||r>=H) return null;
  return {r,c};
}

const noncanonKeys = new Set(noncanon.map(n=>`${n.r}_${n.c}`));
// canonical = NOT border sentinel AND NOT in noncanonKeys
const canonCellsInterior = cells.filter(c=>!c.isBorderSentinel && !noncanonKeys.has(`${c.r}_${c.c}`));
const canonKeys = new Set(canonCellsInterior.map(c=>`${c.r}_${c.c}`));
console.log('Interior canonical:', canonKeys.size);
console.log('Interior non-canonical:', noncanonKeys.size);
console.log('Total interior:', canonKeys.size + noncanonKeys.size);

// Helper: place a set of (X,Y) pixel coords into the 240x238 grid,
// count overlap with non-canon vs canonical cells.
function overlap(label, pixels){
  let inCanon=0, inNoncanon=0, inSentinel=0, outOfGrid=0;
  const hitCells = new Set();
  const interiorTotal = canonKeys.size + noncanonKeys.size;
  for(const p of pixels){
    const cell = pxToCell(p.x,p.y);
    if(!cell){ outOfGrid++; continue; }
    const k = `${cell.r}_${cell.c}`;
    hitCells.add(k);
    if(noncanonKeys.has(k)) inNoncanon++;
    else if(canonKeys.has(k)) inCanon++;
    else inSentinel++;
  }
  const distinctNoncanonHit = [...hitCells].filter(k=>noncanonKeys.has(k)).length;
  const distinctTotalHit = hitCells.size;
  // baseline random expectation: noncanon_count / interior_total * pixels-that-landed-interior
  const inInterior = inCanon + inNoncanon;
  const baselineNoncanon = (noncanon.length / interiorTotal) * inInterior;
  console.log(`\n${label}:`);
  console.log(`  total entries: ${pixels.length}`);
  console.log(`  out-of-grid: ${outOfGrid}`);
  console.log(`  in border-sentinel cells: ${inSentinel}`);
  console.log(`  in canonical (interior) cells: ${inCanon}`);
  console.log(`  in non-canonical (interior) cells: ${inNoncanon}`);
  console.log(`  baseline (random for interior): ${baselineNoncanon.toFixed(1)}`);
  const ratio = inNoncanon / (baselineNoncanon || 1);
  console.log(`  enrichment vs baseline: ${ratio.toFixed(2)}x`);
  console.log(`  distinct cells hit (total / non-canon): ${distinctTotalHit} / ${distinctNoncanonHit}`);
  return {inCanon, inNoncanon, ratio, hitCells, distinctNoncanonHit};
}

// Test 1: resources
overlap('Resources', resources.filter(r=>r.x!==null));

// Test 2: characters by type
const charTypes = [...new Set(characters.map(c=>c.type))];
for(const t of charTypes){
  const list = characters.filter(c=>c.type===t && c.x!==null);
  overlap(`Characters[${t}]`, list);
}

// Test 3: by RESOURCE TYPE
console.log('\n--- Per-resource-type non-canon enrichment ---');
const perType = {};
for(const r of resources){
  if(r.x===null) continue;
  const cell = pxToCell(r.x,r.y);
  if(!cell) continue;
  const k = `${cell.r}_${cell.c}`;
  // skip if it landed on a border sentinel (anti-diag etc)
  if(!canonKeys.has(k) && !noncanonKeys.has(k)) continue;
  if(!perType[r.type]) perType[r.type] = {total:0, noncanon:0};
  perType[r.type].total++;
  if(noncanonKeys.has(k)) perType[r.type].noncanon++;
}
// baseline ratio uses INTERIOR only (excluding sentinels)
const baselineRatio = noncanon.length / (canonKeys.size + noncanonKeys.size);
console.log(`baseline non-canon fraction: ${(baselineRatio*100).toFixed(3)}%`);
const rows = Object.entries(perType).map(([t,v])=>{
  const expected = baselineRatio * v.total;
  const enrichment = v.noncanon / (expected || 1);
  return {type:t, total:v.total, noncanon:v.noncanon, expected:expected.toFixed(2), enrichment:enrichment.toFixed(2)+'x'};
});
rows.sort((a,b)=>parseFloat(b.enrichment)-parseFloat(a.enrichment));
console.table(rows);

// Test 4: spatial overlap measure
//   For each NON-CANON cell: nearest resource (px distance to nearest resource center)
//   Compare to canonical cells.
function nearestDist(cellR, cellC, pixels){
  const cx = cellC*PX_PER_CELL_X + PX_PER_CELL_X/2;
  const cy = cellR*PX_PER_CELL_Y + PX_PER_CELL_Y/2;
  let best = Infinity;
  for(const p of pixels){
    const dx = p.x-cx, dy=p.y-cy;
    const d = Math.sqrt(dx*dx+dy*dy);
    if(d<best) best=d;
  }
  return best;
}

const allResources = resources.filter(r=>r.x!==null);

// Sample 1000 cells of each type for speed
function samplePix(arr,n){
  const out = [];
  const used = new Set();
  while(out.length<n && out.length<arr.length){
    const idx = Math.floor(Math.random()*arr.length);
    if(used.has(idx)) continue;
    used.add(idx);
    out.push(arr[idx]);
  }
  return out;
}

const ncSample = samplePix(noncanon, Math.min(noncanon.length, 697));
const canonCells = cells.filter(c=>!noncanonKeys.has(`${c.r}_${c.c}`));
const cSample = samplePix(canonCells, 697);

let ncDistSum=0, cDistSum=0;
const ncDists=[], cDists=[];
for(const n of ncSample){ const d=nearestDist(n.r,n.c,allResources); ncDistSum+=d; ncDists.push(d); }
for(const n of cSample){ const d=nearestDist(n.r,n.c,allResources); cDistSum+=d; cDists.push(d); }
console.log('\n--- Nearest-resource pixel-distance (697 each) ---');
console.log(`  Non-canon mean: ${(ncDistSum/ncSample.length).toFixed(2)} px`);
console.log(`  Canonical mean: ${(cDistSum/cSample.length).toFixed(2)} px`);
ncDists.sort((a,b)=>a-b); cDists.sort((a,b)=>a-b);
console.log(`  Non-canon p50: ${ncDists[Math.floor(ncDists.length*0.5)].toFixed(2)}, p25: ${ncDists[Math.floor(ncDists.length*0.25)].toFixed(2)}`);
console.log(`  Canonical p50: ${cDists[Math.floor(cDists.length*0.5)].toFixed(2)}, p25: ${cDists[Math.floor(cDists.length*0.25)].toFixed(2)}`);
