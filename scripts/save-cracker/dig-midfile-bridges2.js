// dig-midfile-bridges2.js — bridges (white pixels in map_features) → mid-file array.
// Exclude edge-markers (bottom row, rightmost col) to get true signal.

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

// Mask out edge markers (rightmost col + bottom row)
const interiorMask = new Uint8Array(W*H);
let interiorCount = 0;
let interiorNonCanon = 0;
for(let y=0;y<H;y++){
  for(let x=0;x<W;x++){
    if(x === W-1 || y === H-1) continue;
    const idx = y*W + x;
    interiorMask[idx] = 1;
    interiorCount++;
    if(mask[idx] === 0) interiorNonCanon++;
  }
}
const interiorBaseline = interiorNonCanon / interiorCount;
console.log('Interior cells:', interiorCount, 'interior non-canon:', interiorNonCanon, 'baseline:', (interiorBaseline*100).toFixed(2)+'%');

// Read map_features
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

const features = readTGA('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS Classic Beta/data/world/maps/base/map_features.tga');

// Bridges = white pixels
function isWhite(p){ return p.r===255 && p.g===255 && p.b===255; }
function toGrid(x, y){
  const cx = Math.floor(x * W / features.w);
  const cy = Math.floor(y * H / features.h);
  return cy*W + cx;
}
const bridgeCells = new Set();
for(let y=0;y<features.h;y++){
  for(let x=0;x<features.w;x++){
    if(isWhite(features.getPixel(x,y))) bridgeCells.add(toGrid(x,y));
  }
}
console.log('\nWhite-pixel (bridge) cells:', bridgeCells.size);
let bridgeNC = 0;
let bridgeCanon = 0;
let edgeExcludedNC = 0;
for(const cell of bridgeCells){
  const x = cell % W, y = Math.floor(cell/W);
  if(x === W-1 || y === H-1) continue;
  if(mask[cell] === 0) bridgeNC++;
  else bridgeCanon++;
}
const interiorBridgeCells = [...bridgeCells].filter(c=>{
  const x=c%W, y=Math.floor(c/W);
  return x !== W-1 && y !== H-1;
});
console.log('Interior bridge cells:', interiorBridgeCells.length, 'non-canon:', bridgeNC);
const bridgeRate = bridgeNC/interiorBridgeCells.length;
console.log('Bridge interior non-canon rate:', (bridgeRate*100).toFixed(2)+'%, ratio='+(bridgeRate/interiorBaseline).toFixed(2)+'x baseline');

// Yellow pixels (00 ff ff = aqua/cyan in BGR which my reader returns as cyan via swap)
function isCyan(p){ return p.r===0 && p.g===255 && p.b===255; }
const cyanCells = new Set();
for(let y=0;y<features.h;y++){
  for(let x=0;x<features.w;x++){
    if(isCyan(features.getPixel(x,y))) cyanCells.add(toGrid(x,y));
  }
}
let cyanNC = 0;
const interiorCyanCells = [...cyanCells].filter(c=>{
  const x=c%W, y=Math.floor(c/W);
  return x !== W-1 && y !== H-1;
});
for(const c of interiorCyanCells) if(mask[c]===0) cyanNC++;
console.log('Cyan (00ffff) interior cells:', interiorCyanCells.length, 'non-canon:', cyanNC, 'rate ratio:', (cyanNC/interiorCyanCells.length/interiorBaseline).toFixed(2)+'x');

// Blue pixels (rivers/lakes?)
function isBlue(p){ return p.r===0 && p.g===0 && p.b===255; }
const blueCells = new Set();
for(let y=0;y<features.h;y++){
  for(let x=0;x<features.w;x++){
    if(isBlue(features.getPixel(x,y))) blueCells.add(toGrid(x,y));
  }
}
const interiorBlueCells = [...blueCells].filter(c=>{
  const x=c%W, y=Math.floor(c/W);
  return x !== W-1 && y !== H-1;
});
let blueNC = 0;
for(const c of interiorBlueCells) if(mask[c]===0) blueNC++;
console.log('Blue (0000ff, rivers) interior cells:', interiorBlueCells.length, 'non-canon:', blueNC, 'rate ratio:', (blueNC/interiorBlueCells.length/interiorBaseline).toFixed(2)+'x');

// Now do per-variant analysis: which variant matches white pixel cells best?
// Build per-variant cell sets
function variantKey(buf, off){
  return readU32(buf, off+16)+'_'+readU32(buf, off+20)+'_'+readU32(buf, off+24)+'_'+readU32(buf, off+28)+'_'+readU32(buf, off+32);
}
const cellVariant = new Map(); // cell -> variantKey
for(let i=0;i<W*H;i++){
  const off = START + i*STRIDE;
  cellVariant.set(i, variantKey(rome10, off));
}
const variantCounts = new Map();
for(const v of cellVariant.values()) variantCounts.set(v, (variantCounts.get(v)||0)+1);
const sortV = [...variantCounts.entries()].sort((a,b)=>b[1]-a[1]);
console.log('\nVariant histogram:');
for(const [v, c] of sortV) console.log('  '+v+': '+c);

// For each variant, fraction of cells that are bridges
console.log('\nPer-variant: fraction of cells that hit bridges:');
const interiorBridgeSet = new Set(interiorBridgeCells);
for(const [v, total] of sortV){
  let hit = 0;
  let interiorTotal = 0;
  for(let i=0;i<W*H;i++){
    const x=i%W, y=Math.floor(i/W);
    if(x === W-1 || y === H-1) continue;
    if(cellVariant.get(i) !== v) continue;
    interiorTotal++;
    if(interiorBridgeSet.has(i)) hit++;
  }
  if(interiorTotal < 5) continue;
  console.log('  '+v+': '+hit+'/'+interiorTotal+' = '+(hit/interiorTotal*100).toFixed(2)+'% bridges');
}
