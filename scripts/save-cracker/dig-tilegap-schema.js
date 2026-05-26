// dig-tilegap-schema.js — full schema of the 267-byte record; find ALL non-zero/varying bytes
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

const buf = fs.readFileSync(DIR+'save_t0.sav');
const first = buf.indexOf(MAGIC);
const STRIDE=267;
let N=0,p=first;
while(p+20<=buf.length && buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200){N++;p+=STRIDE;}
console.log('N=',N,'block @0x'+first.toString(16),'..0x'+(first+N*STRIDE).toString(16));

// per-byte: is it constant across all records? what value?
const constVal = new Array(STRIDE).fill(-1);
const varies = new Array(STRIDE).fill(false);
for(let j=0;j<STRIDE;j++){
  let v = buf[first+j];
  for(let i=1;i<N;i++){ if(buf[first+i*STRIDE+j]!==v){ varies[j]=true; break; } }
  if(!varies[j]) constVal[j]=v;
}
console.log('\nCONSTANT bytes (same value in all 57120 records):');
let line='';
for(let j=0;j<STRIDE;j++){ if(!varies[j]) line+=`+${j}=${constVal[j]} `; }
console.log('  '+(line||'(none)'));
console.log('\nVARYING byte positions:');
console.log('  '+ varies.map((v,j)=>v?j:null).filter(x=>x!==null).join(', '));

// Decode constant region as u32 fields
console.log('\nConstant u32 interpretation (first record):');
for(let j=0;j<STRIDE-3;j+=4){
  const v=buf.readUInt32LE(first+j);
  if(v!==0) console.log(`  +${j} = ${v} (0x${v.toString(16)})`);
}

// Count distribution of the varying fields
function dist(off, sz){
  const m={};
  for(let i=0;i<N;i++){ const v= sz===4?buf.readUInt32LE(first+i*STRIDE+off): buf[first+i*STRIDE+off]; m[v]=(m[v]||0)+1; }
  return m;
}
for(const off of [20,28,32]){
  const d=dist(off,4);
  console.log(`\n+${off} value distribution:`, JSON.stringify(Object.entries(d).sort((a,b)=>b[1]-a[1]).slice(0,8)));
}
