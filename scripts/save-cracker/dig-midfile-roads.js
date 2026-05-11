// dig-midfile-roads.js — test the mid-file 240×238 grid against map_roughness (roads)
// and map_features (rivers/bridges/forests) — the session 18 leftover hypothesis.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');

// Find the mid-file array at offset 0xf8fd2 (session 18)
const START = 0xf8fd2;
const W = 240;
const H = 238;
const STRIDE = 267;

// Build canonical mask: read each record, mark canonical if matches
// canonical pattern: +0=5, +12=10, +16/+20/+32=200, +24=2, +28=6, +84=576, +96=0xa6, +97..+266=0
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

// Build the 240x238 canonical mask
console.log('Building canonical mask (240×238)...');
const mask = new Uint8Array(W*H);
for(let i=0;i<W*H;i++){
  const off = START + i*STRIDE;
  if(off + STRIDE > rome10.length) break;
  mask[i] = isCanonical(rome10, off) ? 1 : 0;
}
let canonCount = 0;
for(let i=0;i<W*H;i++) canonCount += mask[i];
console.log('Canonical cells:', canonCount, '/', W*H, '(' + ((canonCount/(W*H))*100).toFixed(2) + '%)');
console.log('Non-canonical cells:', W*H - canonCount);

// Helper: read TGA pixels (24-bit, BGR LE, flipped Y origin)
function readTGA(path){
  const buf = fs.readFileSync(path);
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const depth = buf[16];
  const descriptor = buf[17];
  const yFlip = (descriptor & 0x20) === 0; // bit 5: 0=bottom-up, 1=top-down
  const id_len = buf[0];
  const pixOff = 18 + id_len;
  console.log('  TGA: '+w+'x'+h+' depth='+depth+' yflip='+yFlip);
  const bpp = depth/8;
  function getPixel(x, y){
    if(x < 0 || x >= w || y < 0 || y >= h) return null;
    const srcY = yFlip ? (h-1-y) : y;
    const off = pixOff + (srcY*w + x)*bpp;
    return {b: buf[off], g: buf[off+1], r: buf[off+2]};
  }
  return {w, h, getPixel};
}

// Map TGA pixel to grid cell. Mid-file array is 240x238 = 1020/4.25 × 700/2.94 (12.5px per cell)
function toGridCell(x, y, gridW, gridH, tgaW, tgaH){
  const cx = Math.floor(x * gridW / tgaW);
  const cy = Math.floor(y * gridH / tgaH);
  return cy*gridW + cx;
}

// Test against map_roughness (roads overlay in RTW)
const RIS_BASE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS Classic Beta/data/world/maps/';
console.log('\n=== Testing map_features.tga (rivers, forests, bridges) ===');
const features = readTGA(RIS_BASE + 'base/map_features.tga');
// Histogram pixel colors
const colorCount = new Map();
for(let y=0;y<features.h;y++){
  for(let x=0;x<features.w;x++){
    const p = features.getPixel(x,y);
    const key = (p.r<<16)|(p.g<<8)|p.b;
    colorCount.set(key, (colorCount.get(key)||0)+1);
  }
}
const sortColors = [...colorCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log('Top 15 colors in map_features:');
for(const [c, n] of sortColors){
  console.log('  RGB=0x'+c.toString(16).padStart(6,'0')+': '+n+' pixels');
}

// For each color, compute hit rate on non-canonical cells
console.log('\nColor → cell-hit on non-canonical:');
for(const [c, total] of sortColors){
  if(total < 100) continue;
  const r = (c>>16)&0xff, g = (c>>8)&0xff, b = c&0xff;
  // Count non-canonical cells that have at least one pixel of this color
  const cellHasColor = new Set();
  for(let y=0;y<features.h;y++){
    for(let x=0;x<features.w;x++){
      const p = features.getPixel(x,y);
      if(p.r===r && p.g===g && p.b===b){
        const cell = toGridCell(x, y, W, H, features.w, features.h);
        cellHasColor.add(cell);
      }
    }
  }
  // Of those cells, how many are non-canonical?
  let nonCanonHits = 0;
  let canonHits = 0;
  for(const cell of cellHasColor){
    if(mask[cell] === 0) nonCanonHits++;
    else canonHits++;
  }
  const ncRate = nonCanonHits / cellHasColor.size;
  const expected = (W*H - canonCount) / (W*H);
  const ratio = ncRate / expected;
  console.log('  RGB('+r+','+g+','+b+'): '+cellHasColor.size+' cells, '+nonCanonHits+' non-canon ('+ (ncRate*100).toFixed(1)+'%), ratio='+ratio.toFixed(2));
}

// Now test map_roughness — same approach
console.log('\n=== Testing map_roughness.tga (terrain difficulty / roads) ===');
const rough = readTGA(RIS_BASE + 'base/map_roughness.tga');
const colorCount2 = new Map();
for(let y=0;y<rough.h;y++){
  for(let x=0;x<rough.w;x++){
    const p = rough.getPixel(x,y);
    const key = (p.r<<16)|(p.g<<8)|p.b;
    colorCount2.set(key, (colorCount2.get(key)||0)+1);
  }
}
const sc2 = [...colorCount2.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log('Top 8 colors:');
for(const [c, n] of sc2){
  const r = (c>>16)&0xff, g = (c>>8)&0xff, b = c&0xff;
  console.log('  RGB('+r+','+g+','+b+'): '+n+' pixels');
}
for(const [c, total] of sc2){
  if(total < 100) continue;
  const r = (c>>16)&0xff, g = (c>>8)&0xff, b = c&0xff;
  const cellHasColor = new Set();
  for(let y=0;y<rough.h;y++){
    for(let x=0;x<rough.w;x++){
      const p = rough.getPixel(x,y);
      if(p.r===r && p.g===g && p.b===b){
        cellHasColor.add(toGridCell(x, y, W, H, rough.w, rough.h));
      }
    }
  }
  let nonCanonHits = 0;
  for(const cell of cellHasColor){
    if(mask[cell] === 0) nonCanonHits++;
  }
  const ncRate = nonCanonHits / cellHasColor.size;
  const expected = (W*H - canonCount) / (W*H);
  const ratio = ncRate / expected;
  console.log('  RGB('+r+','+g+','+b+'): '+cellHasColor.size+' cells, '+nonCanonHits+' non-canon ('+(ncRate*100).toFixed(1)+'%), ratio='+ratio.toFixed(2));
}
