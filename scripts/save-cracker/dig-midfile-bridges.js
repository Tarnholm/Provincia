// dig-midfile-bridges.js — white pixels in map_features got 2.74x ratio → could be bridges.
// And green/yellow pixels in map_features are forests/rivers - check those carefully.
// Also fix map_roughness reader (it's 8-bit palette).

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
  // colormap?
  if(colormap_type === 1){
    const colormapLen = buf.readUInt16LE(5);
    const colormapDepth = buf[7];
    pixOff += colormapLen * (colormapDepth/8);
  }
  const bpp = depth/8;
  function getPixel(x, y){
    if(x < 0 || x >= w || y < 0 || y >= h) return null;
    const srcY = yFlip ? (h-1-y) : y;
    const off = pixOff + (srcY*w + x)*bpp;
    if(bpp === 1) return {r: buf[off], g: buf[off], b: buf[off], i: buf[off]};
    return {r: buf[off+2], g: buf[off+1], b: buf[off]};
  }
  return {w, h, getPixel};
}

// Test white pixels in map_features
const RIS_BASE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS Classic Beta/data/world/maps/';
console.log('=== map_features white pixels ===');
const features = readTGA(RIS_BASE + 'base/map_features.tga');
console.log('Features TGA:', features.w+'x'+features.h);
const whitePix = [];
for(let y=0;y<features.h;y++){
  for(let x=0;x<features.w;x++){
    const p = features.getPixel(x,y);
    if(p.r===255 && p.g===255 && p.b===255) whitePix.push({x,y});
  }
}
console.log('White pixels:', whitePix.length);
console.log('First 20 white pixel positions:');
for(const p of whitePix.slice(0,20)) console.log('  ('+p.x+','+p.y+')');

// Map them to grid cells
function toGridCell(x, y){
  // 1020/240 = 4.25 ; 700/238 = 2.94
  const cx = Math.floor(x * W / features.w);
  const cy = Math.floor(y * H / features.h);
  return cy*W + cx;
}
const wCells = new Set();
for(const p of whitePix) wCells.add(toGridCell(p.x, p.y));
let wHits = 0;
for(const c of wCells) if(mask[c]===0) wHits++;
console.log('White cells:', wCells.size, 'non-canon hits:', wHits, '('+((wHits/wCells.size)*100).toFixed(1)+'%, ratio='+((wHits/wCells.size)/(1389/57120)).toFixed(2)+'x baseline)');

// Red pixels (rivers in map_features?)
const redPix = [];
for(let y=0;y<features.h;y++){
  for(let x=0;x<features.w;x++){
    const p = features.getPixel(x,y);
    if(p.r===255 && p.g===0 && p.b===0) redPix.push({x,y});
  }
}
console.log('\nRed pixels (potential rivers):', redPix.length);
const rCells = new Set();
for(const p of redPix) rCells.add(toGridCell(p.x, p.y));
let rHits = 0;
for(const c of rCells) if(mask[c]===0) rHits++;
console.log('Red cells:', rCells.size, 'non-canon hits:', rHits, '('+((rHits/rCells.size)*100).toFixed(1)+'%, ratio='+((rHits/rCells.size)/(1389/57120)).toFixed(2)+'x baseline)');

// Try map_roughness as 8-bit palette
console.log('\n=== map_roughness (8-bit) ===');
const rough = readTGA(RIS_BASE + 'base/map_roughness.tga');
console.log('Roughness TGA:', rough.w+'x'+rough.h);
const indexCount = new Map();
for(let y=0;y<rough.h;y++){
  for(let x=0;x<rough.w;x++){
    const p = rough.getPixel(x,y);
    indexCount.set(p.i, (indexCount.get(p.i)||0)+1);
  }
}
const sci = [...indexCount.entries()].sort((a,b)=>b[1]-a[1]);
console.log('Top palette indices:');
for(const [i, n] of sci.slice(0,10)){
  console.log('  index='+i+': '+n+' pixels');
}
// Roughness is 2040x1400 (2x map size), so cell = floor(x/8.5) etc
function toGridCellR(x, y){
  const cx = Math.floor(x * W / rough.w);
  const cy = Math.floor(y * H / rough.h);
  return cy*W + cx;
}
console.log('\nPalette-index → non-canonical hit ratio:');
const baseline = 1389/57120;
for(const [i, total] of sci.slice(0,10)){
  if(total < 100) continue;
  const cells = new Set();
  for(let y=0;y<rough.h;y++){
    for(let x=0;x<rough.w;x++){
      const p = rough.getPixel(x,y);
      if(p.i === i){
        cells.add(toGridCellR(x, y));
      }
    }
  }
  let hits = 0;
  for(const c of cells) if(mask[c]===0) hits++;
  const rate = hits/cells.size;
  console.log('  idx='+i+': '+cells.size+' cells, '+hits+' non-canon ('+(rate*100).toFixed(1)+'%, ratio='+(rate/baseline).toFixed(2)+'x baseline)');
}

// Map trade routes
console.log('\n=== map_trade_routes (8-bit?) ===');
const trade = readTGA(RIS_BASE + 'base/map_trade_routes.tga');
console.log('Trade TGA:', trade.w+'x'+trade.h);
const tIdx = new Map();
for(let y=0;y<trade.h;y++){
  for(let x=0;x<trade.w;x++){
    const p = trade.getPixel(x,y);
    const k = (p.r<<16)|(p.g<<8)|p.b;
    tIdx.set(k, (tIdx.get(k)||0)+1);
  }
}
const sct = [...tIdx.entries()].sort((a,b)=>b[1]-a[1]);
console.log('Top colors:');
for(const [c, n] of sct.slice(0,8)){
  const r = (c>>16)&0xff, g = (c>>8)&0xff, b = c&0xff;
  console.log('  RGB('+r+','+g+','+b+'): '+n+' pixels');
}
function toGridCellT(x, y){
  const cx = Math.floor(x * W / trade.w);
  const cy = Math.floor(y * H / trade.h);
  return cy*W + cx;
}
for(const [c, total] of sct.slice(0,8)){
  if(total < 100) continue;
  const r = (c>>16)&0xff, g = (c>>8)&0xff, b = c&0xff;
  const cells = new Set();
  for(let y=0;y<trade.h;y++){
    for(let x=0;x<trade.w;x++){
      const p = trade.getPixel(x,y);
      if(p.r===r && p.g===g && p.b===b){
        cells.add(toGridCellT(x, y));
      }
    }
  }
  let hits = 0;
  for(const c2 of cells) if(mask[c2]===0) hits++;
  const rate = hits/cells.size;
  console.log('  RGB('+r+','+g+','+b+'): '+cells.size+' cells, '+hits+' non-canon ('+(rate*100).toFixed(1)+'%, ratio='+(rate/baseline).toFixed(2)+'x)');
}
