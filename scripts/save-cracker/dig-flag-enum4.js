// Session 27 — Validate idB semantics + compare T1..T5 event counts across the archive.
// Hypothesis from session 26: idB is "campaign year" with 270 BC = idB=270.
// But T5 save has only 17-26 events at idB=270..275 and 80+ at idB=475+. So idB might NOT be year.
//
// Alternative: idB = "year-counter" but events accumulate at the END of the timeline
// (events scheduled into the future, retroactive history filling, etc.)

const fs = require('fs');

function parseEventLog(buf, START, END) {
  const STRIDE = 12;
  const N = Math.floor((END - START) / STRIDE);
  const recs = [];
  for (let i = 0; i < N; i++) {
    const o = START + i*STRIDE;
    recs.push({
      i, o,
      hash: buf.readUInt32LE(o) >>> 0,
      flag: buf[o+4], sub: buf[o+5],
      idA: buf.readUInt16LE(o+6),
      idB: buf.readUInt32LE(o+8)
    });
  }
  return recs;
}

// rome10 first
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);
const recs = parseEventLog(buf, 0x51b5, 0x846af);
const valid = recs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800 && r.idA < 4096);

// idB distribution: bin by ranges
console.log('=== rome10: idB distribution (bin=50) ===');
const bins = {};
for (const r of valid) {
  const b = Math.floor(r.idB / 50) * 50;
  bins[b] = (bins[b]||0)+1;
}
Object.entries(bins).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([b,c])=>{
  const bar = '#'.repeat(Math.floor(c/30));
  console.log('  idB=' + b.padStart(4) + '..' + (parseInt(b)+49).toString().padStart(3) + ': ' + c.toString().padStart(5) + ' ' + bar);
});

// Show idB densest years
const yh = {};
for (const r of valid) yh[r.idB] = (yh[r.idB]||0)+1;
const topY = Object.entries(yh).sort((a,b)=>b[1]-a[1]).slice(0,30);
console.log('\n=== rome10: densest idB years (top 30) ===');
topY.forEach(([y,c])=>console.log('  idB=' + y + ': ' + c + ' events'));

// Top idA values per top-density year
console.log('\n=== Sample events per densest year (top 3) ===');
for (const [y, c] of topY.slice(0,3)) {
  const here = valid.filter(r=>r.idB === parseInt(y));
  console.log('  idB=' + y + ' (' + c + ' events):');
  console.log('    idA range:', Math.min(...here.map(r=>r.idA)), '..', Math.max(...here.map(r=>r.idA)));
  const hH = {};
  for (const r of here) hH[r.hash] = (hH[r.hash]||0)+1;
  const topH = Object.entries(hH).sort((a,b)=>b[1]-a[1]).slice(0,5);
  console.log('    top actors:');
  topH.forEach(([h,c])=>console.log('      0x' + parseInt(h).toString(16).padStart(8,'0') + ': ' + c + ' events'));
}

// Compare T1 vs T5 archive — should T5 have MORE events than T1
const ARCHIVE = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const archiveFiles = require('fs').readdirSync(ARCHIVE).filter(f=>f.endsWith('.sav')).sort();
console.log('\n=== Archive saves: event counts ===');
for (const f of archiveFiles) {
  const ab = fs.readFileSync(ARCHIVE + f);
  // Find event log: scan for hash=0x0bd122ec or similar pattern + flag=1 sub=0x20
  // Better: find the section that contains pattern "01 20 .. .. .. .. 00 00" repeated
  // Just dump file size and try the same offsets
  // The address may differ but section structure should be similar. Find best candidate.
  let bestOff = -1, bestCount = 0;
  for (let candidate = 0x5000; candidate < Math.min(0x10000, ab.length-100000); candidate += 0x100) {
    let c = 0;
    for (let j = 0; j < 1000; j++) {
      const o = candidate + j*12;
      if (o + 12 > ab.length) break;
      const flag = ab[o+4], sub = ab[o+5];
      const idA = ab.readUInt16LE(o+6);
      const idB = ab.readUInt32LE(o+8);
      if ((flag===1||flag===2||flag===4) && (sub===0||sub===0x20) && idB > 0 && idB < 800 && idA < 4096) c++;
    }
    if (c > bestCount) { bestCount = c; bestOff = candidate; }
  }
  // Estimate event log size — try parsing from bestOff for 521KB
  const tryEnd = Math.min(bestOff + 521466, ab.length);
  const ar = parseEventLog(ab, bestOff, tryEnd);
  const av = ar.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800 && r.idA < 4096);
  const inGame = av.filter(r=>r.idB >= 270);
  // Distribution
  const f1 = av.filter(r=>r.flag===1).length;
  const f2 = av.filter(r=>r.flag===2).length;
  const f4 = av.filter(r=>r.flag===4).length;
  console.log('  ' + f.substring(0,55).padEnd(56) + ' size=' + (ab.length/1024/1024).toFixed(1) + 'MB' +
              ' bestOff=0x' + bestOff.toString(16) + ' valid=' + av.length + ' f1=' + f1 + ' f2=' + f2 + ' f4=' + f4);
}
