// dig-tilegap-truestart.js — find true block start/end using stable template bytes (not the magic which misses boundary rows)
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

function isRec(buf, p, stride){
  // template bytes that are constant even on boundary records:
  // +0=5,+12=10,+16=200,+24=2,+68=3,+84=576(=64,2 at bytes 84,85)
  return buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200
      && buf.readUInt32LE(p+24)===2 && buf.readUInt32LE(p+68)===3 && buf[p+84]===64 && buf[p+85]===2;
}
function go(s, stride){
  const buf = fs.readFileSync(DIR+s);
  const anchor = buf.indexOf(MAGIC);
  // walk backward
  let start=anchor;
  while(start-stride>=0 && isRec(buf,start-stride,stride)) start-=stride;
  // walk forward
  let end=anchor;
  while(isRec(buf,end,stride)) end+=stride;
  const N=(end-start)/stride;
  console.log(`\n=== ${s} stride=${stride} ===`);
  console.log(`  TRUE block: 0x${start.toString(16)} .. 0x${end.toString(16)}  size=${end-start} (${((end-start)/1e6).toFixed(2)} MB)`);
  console.log(`  N records = ${N}`);
  // factor N
  const facs=[]; for(let w=2;w<=Math.sqrt(N)+1;w++){ if(N%w===0) facs.push(`${w}x${N/w}`); }
  console.log(`  factor pairs: ${facs.join(', ')}`);
  // dump the first true record
  console.log('  first record fields: +20='+buf.readUInt32LE(start+20)+' +28='+buf.readUInt32LE(start+28)+' +32='+buf.readUInt32LE(start+32));
  return {start,end,N};
}
go('save_17-05-2026   Spain   Turn 1.sav', 115);
go('save_t0.sav', 267);
go('save_macedon t0.sav', 267);
