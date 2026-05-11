// dig-midfile-coast.js — check if non-canonical cells are COASTAL tiles
// (sea-adjacent land). Coastal tiles are special for AI pathfinding/zone classification.
// Use map_ground_types to identify sea, then look for land cells adjacent to sea.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');

const START = 0xf8fd2;
const W = 240, H = 238, STRIDE = 267;

function readU32(buf, off) { return buf.readUInt32LE(off); }
function isCanonical(buf, off) {
  if(readU32(buf, off+0) !== 5) return false;
  if(readU32(buf, off+12) !== 10) return false;
  if(readU32(buf, off+16) !== 200) return false;
  if(readU32(buf, off+20) !== 200) return false;
  if(readU32(buf, off+24) !== 2) return false;
  if(readU32(buf, off+28) !== 6) return false;
  if(readU32(buf, off+32) !== 200) return false;
  if(readU32(buf, off+84) !== 576) return false;
  if(buf[off+96] !== 0xa6) return false;
  for(let i=97;i<267;i++) if(buf[off+i] !== 0) return false;
  return true;
}

const mask = new Uint8Array(W*H);
for(let i=0;i<W*H;i++){
  mask[i] = isCanonical(rome10, START + i*STRIDE) ? 1 : 0;
}

function readTGA(path){
  const buf = fs.readFileSync(path);
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const depth = buf[16];
  const descriptor = buf[17];
  const yFlip = (descriptor & 0x20) === 0;
  const id_len = buf[0];
  const colormap_type = buf[1];
  let pixOff = 18 + id_len;
  if(colormap_type === 1){
    const colormapLen = buf.readUInt16LE(5);
    const colormapDepth = buf[7];
    pixOff += colormapLen * (colormapDepth/8);
  }
  const bpp = depth/8;
  function getPixel(x, y){
    const srcY = yFlip ? (h-1-y) : y;
    const off = pixOff + (srcY*w + x)*bpp;
    if(bpp === 1) return {r: buf[off], g: buf[off], b: buf[off]};
    return {r: buf[off+2], g: buf[off+1], b: buf[off]};
  }
  return {w, h, getPixel};
}

const gt = readTGA('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS Classic Beta/data/world/maps/base/map_ground_types.tga');
console.log('Ground types TGA:', gt.w+'x'+gt.h);

// Identify what's "sea"  — usually a specific color. Histogram:
const colors = new Map();
for(let y=0;y<gt.h;y++){
  for(let x=0;x<gt.w;x++){
    const p = gt.getPixel(x,y);
    const k = (p.r<<16)|(p.g<<8)|p.b;
    colors.set(k, (colors.get(k)||0)+1);
  }
}
const sc = [...colors.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('Top 10 colors:');
for(const [c, n] of sc){
  const r = (c>>16)&0xff, g = (c>>8)&0xff, b = c&0xff;
  console.log('  RGB('+r+','+g+','+b+'): '+n+' pixels');
}

// In RTW map_ground_types, blue typically = sea/water.
// Look for blue color: pure blue or near-blue.
function isSea(r,g,b){
  // Common RTW sea color is 0x0000FF or similar. Try blue=255 dominant.
  return b > 200 && r < 100 && g < 100;
}

// Build sea/land grid at 240×238 resolution
const seaCell = new Uint8Array(W*H);
function toGrid(x, y){
  return Math.floor(y * H / gt.h) * W + Math.floor(x * W / gt.w);
}
for(let y=0;y<gt.h;y++){
  for(let x=0;x<gt.w;x++){
    const p = gt.getPixel(x,y);
    if(isSea(p.r, p.g, p.b)){
      seaCell[toGrid(x, y)] = 1;
    }
  }
}
let seaCount = 0;
for(let i=0;i<W*H;i++) if(seaCell[i]) seaCount++;
console.log('Sea cells (240×238 grid):', seaCount);

// Coastal cells = land cells that have a sea neighbor
const coastCell = new Uint8Array(W*H);
let coastCount = 0;
for(let y=1;y<H-1;y++){
  for(let x=1;x<W-1;x++){
    const idx = y*W+x;
    if(seaCell[idx]) continue;
    let neighborSea = false;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
      if(seaCell[(y+dy)*W + (x+dx)]) { neighborSea = true; break; }
    }
    if(neighborSea) {
      coastCell[idx] = 1;
      coastCount++;
    }
  }
}
console.log('Coastal land cells:', coastCount);

// Now: non-canonical interior cells
const interiorNonCanon = [];
for(let y=0;y<H-1;y++){
  for(let x=0;x<W-1;x++){
    const idx = y*W+x;
    if(mask[idx] === 0) interiorNonCanon.push(idx);
  }
}
console.log('Interior non-canon cells:', interiorNonCanon.length);

// How many non-canon cells are coastal?
let ncCoast = 0, ncSea = 0, ncLand = 0;
for(const c of interiorNonCanon){
  if(coastCell[c]) ncCoast++;
  else if(seaCell[c]) ncSea++;
  else ncLand++;
}
console.log('  in coastal:', ncCoast);
console.log('  in sea:', ncSea);
console.log('  in inland land:', ncLand);

// Baseline rates
const total = interiorNonCanon.length;
let seaBase = 0, coastBase = 0;
for(let y=0;y<H-1;y++) for(let x=0;x<W-1;x++){
  const idx = y*W+x;
  if(seaCell[idx]) seaBase++;
  if(coastCell[idx]) coastBase++;
}
const interiorTotal = (H-1)*(W-1);
console.log('Baseline sea:', seaBase, '('+(seaBase/interiorTotal*100).toFixed(1)+'%)');
console.log('Baseline coast:', coastBase, '('+(coastBase/interiorTotal*100).toFixed(1)+'%)');
console.log('\nNon-canon coastal rate:', (ncCoast/total*100).toFixed(1)+'% vs baseline '+(coastBase/interiorTotal*100).toFixed(1)+'% → ratio='+((ncCoast/total)/(coastBase/interiorTotal)).toFixed(2)+'x');
console.log('Non-canon sea rate:', (ncSea/total*100).toFixed(1)+'% vs baseline '+(seaBase/interiorTotal*100).toFixed(1)+'% → ratio='+((ncSea/total)/(seaBase/interiorTotal)).toFixed(2)+'x');

// Per-variant breakdown
function variantKey(buf, off){
  return readU32(buf, off+16)+'_'+readU32(buf, off+20)+'_'+readU32(buf, off+24)+'_'+readU32(buf, off+28)+'_'+readU32(buf, off+32);
}
const variantCells = new Map();
for(let i=0;i<W*H;i++){
  const v = variantKey(rome10, START + i*STRIDE);
  if(!variantCells.has(v)) variantCells.set(v, []);
  variantCells.get(v).push(i);
}
console.log('\nPer-variant: sea/coast/land breakdown:');
const sortV = [...variantCells.entries()].sort((a,b)=>b[1].length-a[1].length);
for(const [v, cells] of sortV){
  if(cells.length < 3) continue;
  let s = 0, c = 0, l = 0;
  for(const idx of cells){
    if(seaCell[idx]) s++;
    else if(coastCell[idx]) c++;
    else l++;
  }
  console.log('  '+v+': total='+cells.length+' sea='+s+' coast='+c+' land='+l);
}
