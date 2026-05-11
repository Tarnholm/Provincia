// dig-ai-cache-keytt.js — session 19: decode the "key" field. Key has shape
// 0x00BB AA 01 where AA varies a lot. Hypothesis: AA = target-tile-X.
// And the 3rd u32 (called "turn") = target-tile-Y.
//
// Test: build (key.byte2, turn) tuples and see if they form a coherent 2D distribution
// matching map_regions.tga dimensions or descr_strat unit positions.

const fs = require('fs');
const ALEX_DIR = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const t13e = fs.readFileSync(ALEX_DIR + '0357_save_Autosave   Macedon   Turn 13 End.sav');

function walk(buf, start=0x1024){
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(c >= 300) return recs;
    recs.push({a,b,c,off});
  }
  return recs;
}
const recs = walk(t13e);
console.log('Total records:', recs.length);

// Test: per-hash, get all (key.byte2, turn) pairs. If these are tile coords,
// records for the same hash (presumably same agent) should be near each other
// in space.
const byHash = new Map();
for(const r of recs){
  if(r.a === 0) continue;
  if(!byHash.has(r.a)) byHash.set(r.a, []);
  byHash.get(r.a).push({byte2: (r.b>>>16)&0xff, turn: r.c, b1: (r.b>>>8)&0xff, b0: r.b & 0xff});
}
const sortedH = [...byHash.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,10);

console.log('Top 10 hashes — (byte2, turn) coordinates of their records:');
for(const [h, hrecs] of sortedH){
  console.log('hash=0x'+h.toString(16).padStart(8,'0'));
  for(const r of hrecs){
    console.log('  byte2=0x'+r.byte2.toString(16).padStart(2,'0')+'='+r.byte2+', turn='+r.turn);
  }
  // X-range and Y-range
  const xs = hrecs.map(r=>r.byte2);
  const ys = hrecs.map(r=>r.turn);
  console.log('  → X(byte2) range '+Math.min(...xs)+'..'+Math.max(...xs)+', Y(turn) range '+Math.min(...ys)+'..'+Math.max(...ys));
}

// Hypothesis check: if byte2 = tile-X and turn = tile-Y, do all records for a hash
// cluster spatially? (Or, do they spread out — meaning byte2 is something else)
// For each top hash, compute the spread.
console.log('\nSpread analysis (smaller spread = more spatial coherence):');
for(const [h, hrecs] of sortedH){
  const xs = hrecs.map(r=>r.byte2);
  const ys = hrecs.map(r=>r.turn);
  const meanX = xs.reduce((a,b)=>a+b,0)/xs.length;
  const meanY = ys.reduce((a,b)=>a+b,0)/ys.length;
  let dist = 0;
  for(let i=0;i<xs.length;i++){
    dist += Math.sqrt((xs[i]-meanX)**2 + (ys[i]-meanY)**2);
  }
  dist /= xs.length;
  console.log('  hash=0x'+h.toString(16).padStart(8,'0')+' count='+hrecs.length+' avg-dist-to-mean='+dist.toFixed(2)+' centerX='+meanX.toFixed(1)+' centerY='+meanY.toFixed(1));
}

// Alternate hypothesis: the "turn" field IS a turn number, but it's some
// internal AI-scheduling turn (not game turn). Maybe per-hash, records appear in
// monotonic turn order? Test by checking turn-monotonicity within each hash group.
console.log('\nTurn-monotonicity within each hash group:');
for(const [h, hrecs] of sortedH){
  // Reset orig record order by sorting hrecs into save-file order
  const ordered = recs.filter(r => r.a === h);
  let mono = true;
  let lastT = -1;
  for(const r of ordered){
    if(r.c < lastT) { mono = false; break; }
    lastT = r.c;
  }
  console.log('  hash=0x'+h.toString(16).padStart(8,'0')+' file-order is monotonic in turn: '+mono);
}

// Now show the GLOBAL file-order monotonicity of turn field
let monoBroken = 0;
let lastT = -1;
for(const r of recs){
  if(r.c < lastT) monoBroken++;
  lastT = r.c;
}
console.log('\nGlobally monotonic turn in file order? Breaks:', monoBroken, '/', recs.length);
