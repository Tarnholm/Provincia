// Decode gap B 12-byte records more carefully
const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const START = 0x87e9, END = 0x846af;
const SIZE = END - START;
console.log('Gap B size:', SIZE, '= 12 *', SIZE/12);

const N = SIZE/12;
const recs = [];
for(let i=0;i<N;i++){
  const o = START + i*12;
  const flag = buf[o];
  const sub  = buf[o+1];
  const idA  = buf.readUInt16LE(o+2);
  const idB  = buf.readUInt16LE(o+4);
  const z    = buf.readUInt16LE(o+6);
  const h    = buf.readUInt32LE(o+8);
  recs.push({i, off:o, flag, sub, idA, idB, z, h});
}

const flagH = {};
for(const r of recs) flagH[r.flag]=(flagH[r.flag]||0)+1;
console.log('Flag distribution:', flagH);
const subH = {};
for(const r of recs) subH[r.sub]=(subH[r.sub]||0)+1;
console.log('Sub distribution:', subH);
const zH = {};
for(const r of recs) zH[r.z]=(zH[r.z]||0)+1;
const zE = [...Object.entries(zH)].sort((a,b)=>b[1]-a[1]);
console.log('z (+6) distribution (top 5):', zE.slice(0,5));

const idBs = recs.map(r=>r.idB);
console.log('idB range:', Math.min(...idBs), '..', Math.max(...idBs));
const idAs = recs.map(r=>r.idA);
console.log('idA range:', Math.min(...idAs), '..', Math.max(...idAs));

const idBcounts = {};
for(const r of recs) idBcounts[r.idB]=(idBcounts[r.idB]||0)+1;
const idBtop = [...Object.entries(idBcounts)].sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
console.log('\nidB freq (low end):');
idBtop.slice(0,15).forEach(([k,v])=>console.log('  idB='+k+': '+v+' records'));
console.log('  ...');
console.log('idB freq (high end):');
idBtop.slice(-15).forEach(([k,v])=>console.log('  idB='+k+': '+v+' records'));

const hashCounts = {};
for(const r of recs) hashCounts[r.h]=(hashCounts[r.h]||0)+1;
console.log('\nDistinct hashes:', Object.keys(hashCounts).length);
const topHash = [...Object.entries(hashCounts)].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log('Top 15 hashes:');
topHash.forEach(([h,c])=>console.log('  0x'+(parseInt(h)>>>0).toString(16).padStart(8,'0')+' = '+c));

const ptH = {};
for(const r of recs){
  const t = (r.flag<<8)|r.sub;
  ptH[t]=(ptH[t]||0)+1;
}
console.log('\n(flag<<8)|sub:');
Object.entries(ptH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v])=>console.log('  0x'+parseInt(k).toString(16).padStart(4,'0')+': '+v));

// Compare gap B in rome10 vs RoR-T1
const ROR_T1 = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav';
if(fs.existsSync(ROR_T1)){
  const buf2 = fs.readFileSync(ROR_T1);
  console.log('\nRoR-T1 size:', buf2.length);
  // RoR-T1 has 104 children (per dossier session 12) — let me find kid[0] end in T1
  // Find first child via self-pointer scan
  let firstChildEnd = null;
  for(let off=0x3ba0; off<0x10000; off++){
    const v = buf2.readUInt32LE(off);
    if(v === off){
      const sz = buf2.readUInt32LE(off+4);
      if(sz>1000 && sz<0x100000){
        console.log('RoR-T1 first child @0x'+off.toString(16)+' size=0x'+sz.toString(16));
        firstChildEnd = off + sz;
        break;
      }
    }
  }
  if(firstChildEnd){
    // What's at firstChildEnd?
    let l='';
    for(let j=0;j<12;j++) l += buf2[firstChildEnd+j].toString(16).padStart(2,'0')+' ';
    console.log('RoR-T1 @0x'+firstChildEnd.toString(16)+':', l);
    // Try 12-byte stride records
    let nValid = 0;
    let p = firstChildEnd;
    while(p+12 < buf2.length){
      const f = buf2[p];
      const s = buf2[p+1];
      if((f===1||f===2)&&s===0x20) nValid++;
      else if(nValid>0) break;
      p += 12;
    }
    console.log('RoR-T1 contiguous 12B records starting flag-0x20:', nValid);
  }
}

// idA & idB sequential? Check if when idB increments, the idA values seen are similar
// or different. If idB is "turn" then for higher idB, we'd see fewer entries (since
// game is short). Let me show idB count vs ordinal.
console.log('\nidB index → count (every 50th):');
for(let i=0;i<idBtop.length;i+=50){
  console.log('  idB='+idBtop[i][0]+': '+idBtop[i][1]);
}
console.log('Total distinct idB:', idBtop.length);

// Show first ~30 records as table
console.log('\nFirst 40 records (flag.sub idA idB z hash):');
recs.slice(0,40).forEach(r=>console.log('  ['+r.i.toString().padStart(4)+'] '+r.flag+'.'+r.sub.toString(16).padStart(2,'0')+' idA=0x'+r.idA.toString(16).padStart(4,'0')+' idB=0x'+r.idB.toString(16).padStart(4,'0')+' z=0x'+r.z.toString(16)+' h=0x'+(r.h>>>0).toString(16).padStart(8,'0')));

// Find "anomaly" rows (z != 0)
const anomaly = recs.filter(r=>r.z !== 0);
console.log('\nRecords with z != 0:', anomaly.length);
anomaly.slice(0,5).forEach(r=>console.log('  ['+r.i+']', r));
