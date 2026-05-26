// dig-tilegap-final-record.js — full u32 decode of the record template (both sizes) + RIS geometric render
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);
function blk(f,stride){ const buf=fs.readFileSync(DIR+f); const a=buf.indexOf(MAGIC);
  const isRec=p=>buf.readUInt32LE(p)===5&&buf.readUInt32LE(p+12)===10&&buf.readUInt32LE(p+16)===200&&buf.readUInt32LE(p+24)===2&&buf.readUInt32LE(p+68)===3&&buf[p+84]===64&&buf[p+85]===2;
  let s=a; while(s-stride>=0&&isRec(s-stride))s-=stride; let e=s; while(isRec(e))e+=stride; return {buf,s,e,N:(e-s)/stride,stride}; }

function decode(f,stride){
  const {buf,s,N}=blk(f,stride);
  console.log(`\n=== ${f} : ${stride}-byte record, N=${N} ===  (interior canonical record u32 fields)`);
  // find a canonical interior record
  let idx=Math.floor(N/2);
  const b=s+idx*stride;
  for(let j=0;j+4<=stride;j+=4){ const v=buf.readInt32LE(b+j); if(v!==0) console.log(`  +${j}: ${v}${v<0?' (0x'+(v>>>0).toString(16)+')':''}`); }
}
decode('save_17-05-2026   Spain   Turn 1.sav',115);
decode('save_t0.sav',267);

// RIS 240x238 geometric render of +20 field
const {buf,s,N}=blk('save_t0.sav',267); const W=240,H=238;
console.log('\n=== RIS 240x238 +20 field, sampled every 4 cols / 6 rows (.=200 H=600 0=0) ===');
for(let y=0;y<H;y+=6){ let r=String(y).padStart(3)+' '; for(let x=0;x<W;x+=4){ const v=buf.readUInt32LE(s+(y*W+x)*267+20); r+= v===200?'.':v===600?'H':v===0?'0':'?'; } console.log(r); }
