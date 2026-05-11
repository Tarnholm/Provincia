// Inspect content of the 3 biggest gaps in body root:
//   gap A: 0xf8f9b..0x633bb3 (5.23 MB) — tail
//   gap B: 0x87e9..0x846af   (495 KB)
//   gap C: 0x846d1..0xa8beb  (145 KB)

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const gaps = [
  {name:'A: tail', start:0xf8f9b, end:0x633bb3},
  {name:'B: post-kid0', start:0x87e9, end:0x846af},
  {name:'C: post-846af', start:0x846d1, end:0xa8beb},
];

for(const g of gaps){
  console.log('\n=== Gap '+g.name+' @0x'+g.start.toString(16)+'..0x'+g.end.toString(16)+' size='+(g.end-g.start)+' ===');
  // Byte histogram
  const h = new Uint32Array(256);
  for(let i=g.start;i<g.end;i++) h[buf[i]]++;
  // top 10
  const entries = [];
  for(let i=0;i<256;i++) if(h[i]) entries.push([i,h[i]]);
  entries.sort((a,b)=>b[1]-a[1]);
  console.log(' Top 10 bytes:');
  entries.slice(0,10).forEach(([v,c])=>console.log('  0x'+v.toString(16).padStart(2,'0')+' ('+v+'): '+c+' = '+(100*c/(g.end-g.start)).toFixed(2)+'%'));
  // entropy
  let H=0;
  for(let i=0;i<256;i++) if(h[i]){const p=h[i]/(g.end-g.start); H -= p*Math.log2(p);}
  console.log(' Entropy:', H.toFixed(3), 'bits/byte');
  // ASCII string scan
  console.log(' ASCII runs >=8 chars:');
  let runStart=-1;
  const strs = new Map();
  for(let i=g.start;i<g.end;i++){
    const b = buf[i];
    const isPrint = (b>=0x20&&b<0x7f) || b===9;
    if(isPrint){
      if(runStart<0) runStart=i;
    } else {
      if(runStart>=0 && (i-runStart)>=8){
        const s = buf.slice(runStart, i).toString('ascii');
        strs.set(s, (strs.get(s)||0)+1);
      }
      runStart=-1;
    }
  }
  const strE = [...strs.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(' total distinct ASCII strings:', strE.length);
  strE.slice(0,15).forEach(([s,c])=>console.log('   ['+c+'] '+JSON.stringify(s.slice(0,60))));
  // UTF-16LE strings: alternating ASCII/0
  console.log(' UTF-16LE strings (>=8 chars):');
  const ustrs = new Map();
  for(let i=g.start;i<g.end-2;i++){
    if(buf[i]>=0x20 && buf[i]<0x7f && buf[i+1]===0){
      // scan run
      let j=i;
      while(j<g.end-1 && buf[j]>=0x20 && buf[j]<0x7f && buf[j+1]===0) j+=2;
      if((j-i)>=16){
        const s = buf.slice(i,j).toString('utf16le');
        ustrs.set(s, (ustrs.get(s)||0)+1);
        i=j;
      }
    }
  }
  const ue = [...ustrs.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(' total distinct UTF-16 strings:', ue.length);
  ue.slice(0,30).forEach(([s,c])=>console.log('   ['+c+'] '+JSON.stringify(s.slice(0,70))));

  // First 64 bytes
  let hex=''; for(let i=0;i<Math.min(64,g.end-g.start);i++){hex+=buf[g.start+i].toString(16).padStart(2,'0')+' '; if(i%16===15)hex+='\n  ';}
  console.log(' First 64 bytes:\n  '+hex);
}
