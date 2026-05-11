// dig-tilemap3.js — find all "first non-zero byte" positions, derive exact stride and count
const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(path);
const GAP_START = 0x633bb3, GAP_END = 0xf88637;

// Walk gap, identifying "data clusters" — regions of nonzero bytes separated by >=50 zeros.
const clusters = [];
let inCluster = false, clusterStart = -1, lastNonzero = -1, zeroRun = 0;
for(let i = GAP_START; i < GAP_END; i++){
  if(buf[i] !== 0){
    if(!inCluster){ inCluster = true; clusterStart = i; }
    lastNonzero = i;
    zeroRun = 0;
  } else {
    zeroRun++;
    if(inCluster && zeroRun >= 50){
      clusters.push({start: clusterStart, end: lastNonzero+1, len: lastNonzero - clusterStart + 1});
      inCluster = false;
      clusterStart = -1;
    }
  }
}
if(inCluster){
  clusters.push({start: clusterStart, end: lastNonzero+1, len: lastNonzero - clusterStart + 1});
}
console.log('total clusters:', clusters.length);

// Look at first 20 cluster offsets relative to gap start
console.log('\nfirst 20 cluster gap-offsets:');
for(let i=0;i<Math.min(clusters.length,20);i++){
  const c=clusters[i];
  console.log('  cluster '+i+': start=0x'+c.start.toString(16)+' (gap+'+(c.start-GAP_START)+') len='+c.len);
}

// stride between cluster starts
console.log('\nstride between first 20 cluster starts:');
for(let i=1;i<Math.min(clusters.length,20);i++){
  console.log('  '+(i-1)+'->'+i+': '+(clusters[i].start - clusters[i-1].start));
}

// stride histogram
const strideHist = new Map();
for(let i=1;i<clusters.length;i++){
  const d = clusters[i].start - clusters[i-1].start;
  strideHist.set(d, (strideHist.get(d) || 0) + 1);
}
console.log('\ntop 10 strides (count):');
const sortedStrides = [...strideHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
for(const [d,n] of sortedStrides) console.log('  stride='+d+' count='+n);

// Now: each "cluster" has some bytes inside. What is the typical cluster size?
const lenHist = new Map();
for(const c of clusters){
  lenHist.set(c.len, (lenHist.get(c.len) || 0) + 1);
}
console.log('\ntop 10 cluster lengths:');
const sortedLens = [...lenHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
for(const [l,n] of sortedLens) console.log('  len='+l+' count='+n);

// dump bytes of first cluster
console.log('\nfull bytes of cluster 0:');
const c0 = clusters[0];
for(let i = c0.start; i < c0.end; i++){
  const b = buf[i];
  if(b) console.log('  off+'+(i-c0.start)+' (gap+'+(i-GAP_START)+'): val=0x'+b.toString(16));
}

// We see the pattern — let's identify the EXACT record boundary.
// First nonzero is at gap-offset 157. Records appear every 267 bytes thereafter.
// Likely: stride=267 from cluster-start to cluster-start.
// Total area between first cluster start (0x633bb3+157=0x633c50) and end of gap (0xf88637) = 9783940-157 = 9783783
console.log('\nGap-from-firstcluster size:', 9783940-157);
console.log('  / 267 =', (9783940-157)/267);
