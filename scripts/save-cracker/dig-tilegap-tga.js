const fs = require('fs');
// Returns {w,h,bpp, get(x,y)->{r,g,b}}  with TOP-LEFT origin normalized
function readTGA(path){
  const buf = fs.readFileSync(path);
  const idlen = buf[0];
  const cmaptype = buf[1];
  const imgtype = buf[2]; // 2=uncompressed RGB, 10=RLE RGB, 3=uncompressed gray, 11=RLE gray
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const bpp = buf[16];
  const desc = buf[17];
  const topLeft = (desc & 0x20) !== 0; // bit5: origin top
  const bytesPP = bpp/8;
  let off = 18 + idlen;
  const pixels = Buffer.alloc(w*h*bytesPP);
  if(imgtype===2 || imgtype===3){
    buf.copy(pixels, 0, off, off + w*h*bytesPP);
  } else if(imgtype===10 || imgtype===11){
    let dst=0;
    while(dst < w*h*bytesPP){
      const hdr = buf[off++];
      const count = (hdr & 0x7f)+1;
      if(hdr & 0x80){ // RLE packet
        for(let i=0;i<count;i++){ for(let k=0;k<bytesPP;k++) pixels[dst++]=buf[off+k]; }
        off+=bytesPP;
      } else { // raw
        for(let i=0;i<count*bytesPP;i++) pixels[dst++]=buf[off++];
      }
    }
  } else throw new Error('unsupported imgtype '+imgtype);
  function get(x,y){
    // normalize to top-left
    const yy = topLeft ? y : (h-1-y);
    const o = (yy*w + x)*bytesPP;
    if(bytesPP>=3) return {b:pixels[o], g:pixels[o+1], r:pixels[o+2]};
    return {b:pixels[o], g:pixels[o], r:pixels[o]};
  }
  return {w,h,bpp,imgtype,topLeft,get,pixels,bytesPP};
}
module.exports = {readTGA};
if(require.main===module){
  for(const f of process.argv.slice(2)){
    const t=readTGA(f);
    console.log(`${f}: ${t.w}x${t.h} bpp=${t.bpp} type=${t.imgtype} topLeft=${t.topLeft}`);
    console.log('  corner samples: (0,0)=',t.get(0,0),' (mid)=',t.get(t.w>>1,t.h>>1));
  }
}
