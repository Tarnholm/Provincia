// dig-tilemap11.js — read vanilla map_regions.tga, count land vs sea pixels
// Look for: number of non-sea-color pixels = 36,582?
// And: index of Rome's pixel = ?
const fs = require('fs');
const buf = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data/world/maps/base/map_regions.tga');
const W = buf.readUInt16LE(12);
const H = buf.readUInt16LE(14);
const bpp = buf[16];
console.log('map_regions.tga (base):', W, 'x', H, 'bpp:', bpp);

// TGA pixel data starts at offset 18 (no idLen, no color map)
const PX_OFF = 18;
// each pixel = bpp/8 bytes BGR
const bytesPerPx = bpp/8;
// sea color in RTW typically = 41 140 233 RGB (or some bright blue)
const colors = new Map();
for(let y=0;y<H;y++){
  for(let x=0;x<W;x++){
    const p = PX_OFF + (y*W + x)*bytesPerPx;
    const b = buf[p], g = buf[p+1], r = buf[p+2];
    const key = (r<<16)|(g<<8)|b;
    colors.set(key, (colors.get(key)||0)+1);
  }
}
console.log('total unique colors:', colors.size);
const sorted = [...colors.entries()].sort((a,b)=>b[1]-a[1]);
console.log('top 10:');
for(const [k,c] of sorted.slice(0,10)){
  const r=(k>>16)&0xff, g=(k>>8)&0xff, b=k&0xff;
  console.log('  RGB('+r+','+g+','+b+') (#'+k.toString(16).padStart(6,'0')+'): '+c+' px');
}

// Count NON-sea pixels — assume sea is the most common color (highest count)
const seaCol = sorted[0][0];
const landPx = W*H - sorted[0][1];
console.log('\nSea color count:', sorted[0][1]);
console.log('Land pixels (W*H - sea):', landPx);
console.log('Target: 36,582 (records found in gap)');
console.log('Diff:', landPx - 36582);

// In TGA, origin can be top-left or bottom-left. Check byte 17 (image descriptor)
const descriptor = buf[17];
const origin = (descriptor >> 4) & 0x3;  // 0=bottom-left, 1=bottom-right, 2=top-left, 3=top-right
console.log('\nTGA origin descriptor:', origin, '(0=BL, 2=TL)');

// Rome's pixel: in RTW imperial_campaign, Rome is at game-tile (285, 404) per session 3
// But map_regions.tga is the LOW-res map. Game tiles map to map_regions pixels via scale.
// Game tiles are 1020x624 (the game uses double-resolution). So Rome at (285, 404) game-tile maps to:
//   map x = floor(285 / 4) = 71 (if 4x scale) or 285 / 2 = 142 (if 2x scale)
//   map y = floor(404 / 4) = 101 or 404 / 2 = 202

// Vanilla RTW Imperial map = 255 wide x 156 tall. Game tiles 510 x 312. So Rome at (285, 404):
// 285/2 = 142.5; 404/2 = 202 — but 202 > 156. So scale is actually 510/255 = 2 and tiles are 285/2=142,404/2=202
// 202 > 156 so this can't be right. Maybe game-tile Y is INVERTED (Y=0 at top of map vs Y=0 at bottom)?
// If Y origin is at BOTTOM, then 404 / 2 = 202 from bottom = 156 - 202 = -46 ... no.
// Actually for vanilla Imperial Rome should be near south-center.
// 156 high * 2 = 312 game tiles. Rome at game-tile y=404 doesn't fit!

// Maybe Rome's (285, 404) was for RIS imperial_campaign which is much larger (1020x700 per RIS dossier)
// For vanilla imperial Rome's tile coords from descr_strat:
const dsPath = 'C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const ds = fs.readFileSync(dsPath, 'utf8');
// Find Rome's settlement
const lines = ds.split(/\r?\n/);
for(let i=0;i<lines.length;i++){
  if(/^\s*settlement/.test(lines[i])){
    // next several lines contain region and coords
    for(let j=i; j<Math.min(i+10,lines.length); j++){
      if(/region\s+(\w+)/.test(lines[j])){
        // print
        if(lines[j].includes('Latium')||lines[j].includes('Roma')||lines[j].includes('atium')){
          console.log('found Latium settlement at line', i);
          for(let k=i;k<i+10;k++) console.log('  '+lines[k]);
        }
        break;
      }
    }
  }
}
