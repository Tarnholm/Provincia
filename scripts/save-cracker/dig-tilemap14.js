// dig-tilemap14.js — visualize the variant positions as a 2D grid and compare to map_features.tga
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const GAP_START = 0x633bb3;
const STRIDE = 267;
const FIRST_REC_OFF = GAP_START + 157;
const N_REC = 36582;
const W = 240;
const H = Math.ceil(N_REC / W);

function getKey(n){
  const base = FIRST_REC_OFF + n*STRIDE;
  return `${buf.readUInt32LE(base+16)}_${buf.readUInt32LE(base+20)}_${buf.readUInt32LE(base+24)}_${buf.readUInt32LE(base+28)}_${buf.readUInt32LE(base+32)}`;
}

// Build a 240xH grid of variant codes
const grid = [];
for(let y=0;y<H;y++) grid.push(new Array(W).fill('.'));

const variantCodes = {
  '200_200_2_6_200': '.',
  '200_600_2_6_600': 'H',  // high values both sides
  '200_0_2_54_200': '|',   // vertical-strip pattern (col 101 always)
  '200_200_2_6_600': 'r',  // right edge
  '200_200_2_6_0':   'L',  // left edge or boundary
  '200_0_2_54_4294967286': 'X',
};

for(let n=0;n<N_REC;n++){
  const k = getKey(n);
  const c = variantCodes[k] || '?';
  const x = n % W;
  const y = Math.floor(n / W);
  if(y < H) grid[y][x] = c;
}

console.log('Grid visualization (W=240 cols, H=' + H + ' rows). Top-down, dots=canonical, others=variants:');
// Sample every 4th column (60 cols) and every 5th row (~31 rows) for terminal display
for(let y=0;y<H;y+=3){
  let row = String(y).padStart(3) + ' ';
  for(let x=0;x<W;x+=4) row += grid[y][x];
  console.log(row);
}

console.log('\n\nNow read the corresponding region of map_regions.tga (base) at same dims:');
const tga = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data/world/maps/base/map_regions.tga');
const TW = tga.readUInt16LE(12), TH = tga.readUInt16LE(14);
const PX_OFF = 18;
// TGA bottom-left origin
function pix(x, y_top){
  const tgaY = TH - 1 - y_top;
  const off = PX_OFF + (tgaY*TW + x)*3;
  return {b: tga[off], g: tga[off+1], r: tga[off+2]};
}

const SEA = {r:41, g:140, b:233};
// Render TGA at W=240, H=153 by sampling a sub-rectangle of TGA
// Assume our grid corresponds to TGA pixels (px, py) = (x+offsetX, y+offsetY)
// Test with offset (0,0):
console.log('TGA at (0,0) to (240,153) — land tiles (L) vs sea (.):');
for(let y=0;y<H;y+=3){
  let row = String(y).padStart(3) + ' ';
  for(let x=0;x<W;x+=4){
    if(x>=TW || y>=TH){ row += '?'; continue; }
    const p = pix(x, y);
    if(p.r===SEA.r && p.g===SEA.g && p.b===SEA.b) row += '.';
    else row += 'L';
  }
  console.log(row);
}
