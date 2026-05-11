// Find all self-pointers in the body root region [0x3b99, 0x633bb3)
// Look at what's between them: large gaps imply non-taw content like big string tables
// or fog-of-war maps.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);
const ROOT_OFF=0x3b99, ROOT_END=0x633bb3;

// Scan all self-pointers
const sps = [];
for(let off=ROOT_OFF; off<ROOT_END-8; off++){
  const v = buf.readUInt32LE(off);
  if(v === off){
    const sz = buf.readUInt32LE(off+4);
    if(sz>20 && sz<0x800000 && off+sz<=ROOT_END+8){
      sps.push({off, sz, end: off+sz});
    }
  }
}
console.log('Total candidate self-pointers in body root:', sps.length);

// Many will be embedded inside larger sections. Build a tree: a section's children
// are all self-pointers that fall inside its [off, end).
// Top-level children: those whose parent is body root.
const topLevel = [];
for(const sp of sps){
  // skip body root itself
  if(sp.off === ROOT_OFF) continue;
  // is this contained in any other section that is also contained in body root?
  let isChild = false;
  for(const o of sps){
    if(o.off >= sp.off || o.off === sp.off) continue;
    if(o.off < sp.off && o.end > sp.end && o.off !== ROOT_OFF){
      isChild = true; break;
    }
  }
  if(!isChild) topLevel.push(sp);
}
console.log('Top-level children of body root:', topLevel.length);

// Sort
topLevel.sort((a,b)=>a.off-b.off);
console.log('\nFirst 30 top-level children:');
topLevel.slice(0,30).forEach((c,i)=>console.log(' ['+i+'] @0x'+c.off.toString(16)+' size=0x'+c.sz.toString(16)+' ('+c.sz+'B) end=0x'+c.end.toString(16)));
console.log('\nLast 5 top-level children:');
topLevel.slice(-5).forEach((c,i)=>console.log(' @0x'+c.off.toString(16)+' size=0x'+c.sz.toString(16)+' ('+c.sz+'B)'));

// Largest
const sortedBySize = topLevel.slice().sort((a,b)=>b.sz-a.sz);
console.log('\nLargest 20 top-level children:');
sortedBySize.slice(0,20).forEach((c,i)=>console.log(' size=0x'+c.sz.toString(16)+' ('+c.sz+'B) @0x'+c.off.toString(16)));

// Size histogram
const sizes = topLevel.map(c=>c.sz);
const total = sizes.reduce((a,b)=>a+b,0);
console.log('\nTotal bytes in top-level children:', total, '/', (ROOT_END-ROOT_OFF), '=', (100*total/(ROOT_END-ROOT_OFF)).toFixed(1)+'%');

// Find gaps
const sorted = topLevel.slice().sort((a,b)=>a.off-b.off);
let cursor = ROOT_OFF + 8; // after body root header
const gaps = [];
for(const c of sorted){
  if(c.off > cursor){
    const gap = c.off - cursor;
    if(gap > 100) gaps.push({start: cursor, end: c.off, size: gap});
  }
  cursor = Math.max(cursor, c.end);
}
if(cursor < ROOT_END) gaps.push({start: cursor, end: ROOT_END, size: ROOT_END-cursor});
console.log('\nGaps (>100B) between top-level children:', gaps.length);
gaps.sort((a,b)=>b.size-a.size);
gaps.slice(0,15).forEach(g=>console.log(' gap @0x'+g.start.toString(16)+'..0x'+g.end.toString(16)+' size='+g.size+'B'));

console.log('\nTotal gap bytes:', gaps.reduce((a,b)=>a+b.size,0));
