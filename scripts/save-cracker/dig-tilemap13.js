// dig-tilemap13.js — convert each record's INDEX to (x,y) under various grid hypotheses
// and check if non-canonical records cluster like real map features
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const GAP_START = 0x633bb3;
const STRIDE = 267;
const FIRST_REC_OFF = GAP_START + 157;
const N_REC = 36582;

function getKey(n){
  const base = FIRST_REC_OFF + n*STRIDE;
  return `${buf.readUInt32LE(base+16)}_${buf.readUInt32LE(base+20)}_${buf.readUInt32LE(base+24)}_${buf.readUInt32LE(base+28)}_${buf.readUInt32LE(base+32)}`;
}
function isCanon(n){ return getKey(n) === '200_200_2_6_200'; }

// Read the base map_regions.tga to count land tiles
const TGA_PATH = 'C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data/world/maps/base/map_regions.tga';
const tga = fs.readFileSync(TGA_PATH);
const W = tga.readUInt16LE(12);
const H = tga.readUInt16LE(14);
console.log('map_regions.tga:', W, 'x', H);

// TGA pixel data, BGR, bottom-left origin (descriptor=0 from previous dump)
const PX_OFF = 18;
const SEA_R = 41, SEA_G = 140, SEA_B = 233;

// Build a 2D map: pixel (x,y) where y is 'image-y' = top-down. TGA is bottom-up: row 0 in file = bottom row.
// Convert to image coords (top-left).
function getPixel(x, y){ // y in image coords, top=0
  const tgaY = H - 1 - y;
  const off = PX_OFF + (tgaY*W + x)*3;
  return {b: tga[off], g: tga[off+1], r: tga[off+2]};
}
function isLand(x, y){
  const p = getPixel(x,y);
  return !(p.r === SEA_R && p.g === SEA_G && p.b === SEA_B);
}

// Build flat list of (x,y) for all land tiles in row-major order
const landTiles = [];
for(let y=0;y<H;y++){
  for(let x=0;x<W;x++){
    if(isLand(x,y)) landTiles.push({x,y});
  }
}
console.log('land tiles:', landTiles.length);
console.log('records:', N_REC, 'diff:', N_REC - landTiles.length);

// If grid is 1:1 — exactly one record per land tile — check non-canonical record indices map to specific known features
// We can map record-index k → landTiles[k] = (x,y) IF #records == #landTiles
// But they differ. So maybe game-tile grid is the dual resolution (510x312)?

// Let's also count land tiles in the 510x312 view (each region pixel maps to 4 game tiles)
// Game tile (gx, gy) corresponds to region pixel (gx/2, gy/2)
const GW = W*2;  // 510
const GH = H*2;  // 312
let gameLandTiles = 0;
for(let gy=0;gy<GH;gy++){
  for(let gx=0;gx<GW;gx++){
    const px = Math.floor(gx/2), py = Math.floor(gy/2);
    if(isLand(px,py)) gameLandTiles++;
  }
}
console.log('game-tile land count (510x312, 2x scale):', gameLandTiles);  // should be 4x land

// Hmm. Try: 36,582 ≈ 36,580 = ?
// Look at the records that are FULL canonical and skipped
// Actually instead let me visualize: map record idx → (idx % W, idx / W) for W=255 and check map fit
console.log('\nPretend W=255: map record n → (n%255, n/255)');
console.log('  Last record (36581) → x=' + (36581 % 255) + ', y=' + Math.floor(36581/255));
console.log('  Expected last cell at y=143 < 156 :', 36581/255 < 156);

console.log('\nPretend W=510: ');
console.log('  Last record (36581) → x=' + (36581 % 510) + ', y=' + Math.floor(36581/510));

// Let's check 200_0_2_54_200 variant indices — interpret as (x,y) at W=255
const variant54 = [];
for(let n=0;n<N_REC;n++) if(getKey(n) === '200_0_2_54_200') variant54.push(n);
console.log('\n200_0_2_54_200 variant (' + variant54.length + ' records) as (x,y) at W=255:');
for(const n of variant54.slice(0,15)){
  console.log('  idx '+n+' → ('+(n%255)+', '+Math.floor(n/255)+')');
}

// The +28=54 variant has delta-240 in earlier analysis. If W=255 row width, then a step within same column = 255.
// Delta=240 doesn't match W=255. Maybe rows aren't all the same length, or the array isn't row-major over the map.

// Try: assume the array is a per-region tile list (concatenated regions). Each region has X tiles.
// In that case, record idx doesn't map cleanly to (x,y).

// Let me check at what record indices the 0xff sentinels appear in the array
// 0xff blocks might signal region boundaries
console.log('\nLooking for 0xff bytes in records (as region-boundary markers?):');
let ffRecords = [];
for(let n=0;n<N_REC;n++){
  const base = FIRST_REC_OFF + n*STRIDE;
  let hasff = false;
  for(let off=0;off<97;off++){
    if(buf[base+off]===0xff){ hasff=true; break; }
  }
  if(hasff) ffRecords.push(n);
}
console.log('records containing any 0xff byte:', ffRecords.length);
console.log('first 30:', ffRecords.slice(0,30));
