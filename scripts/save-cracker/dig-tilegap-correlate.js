// dig-tilegap-correlate.js — correlate the 240x238 save record block against map TGAs
const fs = require('fs');
const {readTGA} = require('./dig-tilegap-tga.js');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAP = 'C:/RIS/RIS/data/world/maps/base/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

const buf = fs.readFileSync(DIR+'save_t0.sav');
const first = buf.indexOf(MAGIC);
const STRIDE=267;
let N=0,p=first;
while(p+20<=buf.length && buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200){N++;p+=STRIDE;}
console.log('N records =', N);

function field(off){ const a=new Float64Array(N); for(let i=0;i<N;i++) a[i]=buf.readUInt32LE(first+i*STRIDE+off); return a; }
const f20=field(20), f28=field(28), f32=field(32);

function pearson(a,b){
  let n=a.length, sa=0,sb=0,saa=0,sbb=0,sab=0;
  for(let i=0;i<n;i++){ sa+=a[i]; sb+=b[i]; saa+=a[i]*a[i]; sbb+=b[i]*b[i]; sab+=a[i]*b[i]; }
  const cov=sab/n - (sa/n)*(sb/n);
  const va=saa/n-(sa/n)**2, vb=sbb/n-(sb/n)**2;
  if(va===0||vb===0) return 0;
  return cov/Math.sqrt(va*vb);
}

const dims = [[240,238],[238,240],[204,280],[280,204],[210,272],[272,210],[224,255],[255,224]];
const tgas = {
  ground: readTGA(MAP+'map_ground_types.tga'),
  height: readTGA(MAP+'map_heights.tga'),
  regions: readTGA(MAP+'map_regions.tga'),
};
function isSeaRegion(t,x,y){ const c=t.get(x,y); return c.r===41 && c.g===140 && c.b===247; }

for(const [W,H] of dims){
  if(W*H!==N) continue;
  console.log(`\n--- testing grid ${W}x${H} (and y-flip) ---`);
  for(const yflip of [false,true]){
    for(const [name,t] of Object.entries(tgas)){
      const dval=new Float64Array(N);
      for(let i=0;i<N;i++){
        let gy=(i/W)|0, gx=i%W;
        if(yflip) gy=H-1-gy;
        const tx=Math.floor((gx+0.5)/W*t.w), ty=Math.floor((gy+0.5)/H*t.h);
        const c=t.get(tx,ty);
        dval[i]= (name==='regions')? (c.r*65536+c.g*256+c.b) : c.r;
      }
      console.log(`  yflip=${yflip?'Y':'N'} ${name}: f20=${pearson(f20,dval).toFixed(3)} f28=${pearson(f28,dval).toFixed(3)} f32=${pearson(f32,dval).toFixed(3)}`);
    }
  }
  // sea/land agreement
  const tR = tgas.regions;
  for(const yflip of [false,true]){
    let sea54=0,c54=0, land6=0,c6=0;
    for(let i=0;i<N;i++){
      let gy=(i/W)|0, gx=i%W; if(yflip) gy=H-1-gy;
      const tx=Math.floor((gx+0.5)/W*tR.w), ty=Math.floor((gy+0.5)/H*tR.h);
      const sea = isSeaRegion(tR,tx,ty);
      if(f28[i]===54){ c54++; if(sea) sea54++; }
      if(f28[i]===6){ c6++; if(!sea) land6++; }
    }
    console.log(`  yflip=${yflip?'Y':'N'} f28==54: ${c54} cells, sea=${(100*sea54/c54).toFixed(1)}%  | f28==6: ${c6} cells, land=${(100*land6/c6).toFixed(1)}%`);
  }
}
