// dig-ai-cache-ris10.js — Confirm RIS cache schema. The records at 0x51b5 have shape:
//   hash(u32) + key(u32) + Y(u32)
//   key = u32 where bytes are [type, 0, X_lo, X_hi] (X is u16, tile-X)
// In Alex, key was [type, 0, X, 0] (X was single byte). RIS map is wider so X is u16.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');

// Walk with strict-format AI cache. Records valid if:
//   key byte1 = 0
//   key low byte ∈ {0x01, 0x02, 0x04, 0x80}
//   Y < 240 (tile coords) or Y < 700 (pixel coords)
//
// We'll try both bounds.

function walkCache(buf, start, opts={}){
  const maxY = opts.maxY || 240;
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(c >= maxY) return recs;
    if(((b >>> 8) & 0xff) !== 0) return recs; // byte1 must be 0
    const lb = b & 0xff;
    if(lb !== 0 && lb !== 1 && lb !== 2 && lb !== 4 && lb !== 0x80) return recs;
    const x = (b >>> 16) & 0xffff;
    if(x >= 240) return recs;
    recs.push({a,b,c,off,x,y:c, type: lb});
  }
  return recs;
}

console.log('=== Walk at 0x51b5 with tile bounds (X<240, Y<240) ===');
const recs = walkCache(rome10, 0x51b5, {maxY: 240});
console.log('Records:', recs.length);
console.log('First 30:');
for(let i=0;i<Math.min(30, recs.length); i++){
  const r = recs[i];
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' type=0x'+r.type.toString(16).padStart(2,'0')+' x='+r.x+' y='+r.y);
}

// At what offset does the cache end?
console.log('\nLast 5:');
for(let i=Math.max(0, recs.length-5); i<recs.length; i++){
  const r = recs[i];
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' type=0x'+r.type.toString(16).padStart(2,'0')+' x='+r.x+' y='+r.y);
}
console.log('Cache ends at 0x'+(recs.length ? (recs[recs.length-1].off + 12).toString(16) : '?'));
// Show bytes immediately after cache end
const endOff = (recs.length ? recs[recs.length-1].off + 12 : 0x51b5);
console.log('Bytes after cache end:');
for(let i=0;i<6;i++){
  const off = endOff + i*12;
  console.log('  @0x'+off.toString(16)+': '+Array.from(rome10.slice(off, off+12)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
}

// Now compare type and hash distribution
const types = {}, hashes = new Set();
for(const r of recs){
  types[r.type] = (types[r.type]||0) + 1;
  hashes.add(r.a);
}
console.log('\nType byte histogram:', types);
console.log('Distinct hashes:', hashes.size, '(including 0)');
console.log('Hash=0 records:', recs.filter(r=>r.a===0).length);

// Hash=0 records — what's their x,y distribution?
const h0 = recs.filter(r=>r.a===0);
if(h0.length > 0){
  const xs = h0.map(r=>r.x);
  const ys = h0.map(r=>r.y);
  console.log('Hash=0 X range: '+Math.min(...xs)+'..'+Math.max(...xs)+', Y range: '+Math.min(...ys)+'..'+Math.max(...ys));
}

// Group by hash and print centroids
const byHash = new Map();
for(const r of recs){
  if(!byHash.has(r.a)) byHash.set(r.a, []);
  byHash.get(r.a).push(r);
}
const sortH = [...byHash.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,15);
console.log('\nTop 15 hashes (count, centroid):');
for(const [h, hrecs] of sortH){
  const cx = hrecs.reduce((a,b)=>a+b.x,0)/hrecs.length;
  const cy = hrecs.reduce((a,b)=>a+b.y,0)/hrecs.length;
  console.log('  0x'+h.toString(16).padStart(8,'0')+' count='+hrecs.length+' centroid=('+cx.toFixed(1)+','+cy.toFixed(1)+')');
}
