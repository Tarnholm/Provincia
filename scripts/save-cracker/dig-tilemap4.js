// dig-tilemap4.js — sample many records and look at how they vary
const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(path);
const GAP_START = 0x633bb3;
const STRIDE = 267;
const FIRST_CLUSTER_OFFSET = 157;  // first nonzero byte in gap

// Record N starts at GAP_START + FIRST_CLUSTER_OFFSET + N*STRIDE - some_prefix
// Actually the 97-byte data span sits at relative offset [0..97] within the cluster.
// The cluster start is at GAP_START + 157 + N*STRIDE. The 267 - 97 = 170 zeros come before.
// So full record layout: 170 zeros (prefix) + 97 data bytes
// Let's analyze relative to cluster start (= GAP_START + 157 + N*STRIDE)

const NUM_RECORDS = 36582;
const baseOf = (n) => GAP_START + FIRST_CLUSTER_OFFSET + n * STRIDE;

// Dump first 5 records as bytes (just nonzero positions)
console.log('First 5 records (nonzero bytes):');
for(let n=0;n<5;n++){
  const base = baseOf(n);
  console.log('Record '+n+' @0x'+base.toString(16)+':');
  for(let off=0;off<97;off++){
    const b=buf[base+off];
    if(b) console.log('  +'+off+': 0x'+b.toString(16).padStart(2,'0'));
  }
}

// Compute per-byte-offset histogram across all records
const offHist = new Array(97);
for(let i=0;i<97;i++) offHist[i] = new Map();
for(let n=0;n<NUM_RECORDS;n++){
  const base = baseOf(n);
  for(let off=0;off<97;off++){
    const b = buf[base+off];
    if(b !== 0){
      offHist[off].set(b, (offHist[off].get(b) || 0) + 1);
    }
  }
}

console.log('\nPer-offset value histogram (nonzero values, top 5 per offset):');
for(let off=0;off<97;off++){
  if(offHist[off].size === 0) continue;
  const entries = [...offHist[off].entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  let s = 'off+'+off.toString().padStart(2)+': ';
  for(const [v,c] of entries) s += '0x'+v.toString(16).padStart(2,'0')+'('+c+') ';
  console.log('  '+s);
}

// Are records all identical?
const firstRec = Buffer.from(buf.slice(baseOf(0), baseOf(0)+97));
let identicalCount = 0;
let lastDiff = null;
for(let n=0;n<NUM_RECORDS;n++){
  const base = baseOf(n);
  let diff = false;
  for(let off=0;off<97;off++){
    if(buf[base+off] !== firstRec[off]){ diff = true; break; }
  }
  if(!diff) identicalCount++;
  else lastDiff = n;
}
console.log('\nidentical to record 0:', identicalCount, '/', NUM_RECORDS);

// Show some different records
const sampledDifferent = [];
for(let n=1;n<NUM_RECORDS && sampledDifferent.length<6;n++){
  const base = baseOf(n);
  for(let off=0;off<97;off++){
    if(buf[base+off] !== firstRec[off]){ sampledDifferent.push(n); break; }
  }
}
console.log('\nfirst 6 records that DIFFER from record 0:', sampledDifferent);
for(const n of sampledDifferent){
  const base = baseOf(n);
  console.log('record '+n+':');
  for(let off=0;off<97;off++){
    if(buf[base+off] !== 0) console.log('  +'+off+': 0x'+buf[base+off].toString(16));
  }
}
