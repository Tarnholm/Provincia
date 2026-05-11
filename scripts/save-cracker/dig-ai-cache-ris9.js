// dig-ai-cache-ris9.js — careful look at the 0x51b5+ block in rome10.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');

// The bytes at 0x51b5+ form 12-byte records where bytes [0..3]=hash, [4..7]=key, [8..11]=Y.
// Walk from 0x51b5 with the correct alignment.

function walk(buf, start, hint='', maxRecs=2000){
  const recs = [];
  for(let off=start; off<buf.length-12 && recs.length<maxRecs; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    recs.push({a,b,c,off, x:(b>>>16)&0xff, y:c});
  }
  return recs;
}

console.log('=== rome10 at 0x51b5 (raw walk, 12-byte stride) ===');
let allRecs = walk(rome10, 0x51b5);
console.log('Walk produced', allRecs.length, 'records (stopped at all-zeros)');
// Find first record where y >= 240 — that's our actual cache end
let cacheEnd = 0x51b5;
for(let i=0;i<allRecs.length;i++){
  if(allRecs[i].y >= 240) { cacheEnd = 0x51b5 + i*12; break; }
}
const cacheLen = (cacheEnd - 0x51b5) / 12;
console.log('Cache valid (y<240) records:', cacheLen);

console.log('\nFirst 20 records (with raw byte hex):');
for(let i=0;i<Math.min(20, allRecs.length); i++){
  const r = allRecs[i];
  const raw = rome10.slice(r.off, r.off+12);
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' y='+r.y+' raw='+Array.from(raw).map(b=>b.toString(16).padStart(2,'0')).join(' '));
}

console.log('\nLast 5 records:');
for(let i=Math.max(0, allRecs.length-5); i<allRecs.length; i++){
  const r = allRecs[i];
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' y='+r.y);
}

// Within map bounds (Y < 240, X < 240)?
const valid = allRecs.filter(r => r.x < 240 && r.y < 240);
console.log('\nRecords with x<240 AND y<240:', valid.length, '/', allRecs.length);
if(valid.length > 0){
  console.log('Sample valid records:');
  for(let i=0;i<Math.min(10, valid.length); i++){
    const r = valid[i];
    console.log('  hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' x='+r.x+' y='+r.y);
  }
}

// Now check what the *encoding* of fields is. Look at the first records' raw bytes:
// 03 01 00 00  00 00 00 00  00 04 00 e6
// Reading as u32 LE:
//   hash = 0x00000103
//   key  = 0x00000000
//   y    = 0xe6000400 (large, NOT valid Y)
//
// But we want y < 240. Maybe the format here is:
//   field0(u32 LE) = key
//   field1(u32 LE) = y
//   field2(u32 LE) = hash
// Try reading bytes [0..3]=Y, [4..7]=hash, [8..11]=key

console.log('\n=== Alternative interpretation (Y, hash, key) ===');
console.log('  Y values from bytes [0..3]:');
for(let i=0;i<20;i++){
  const off = 0x51b5 + i*12;
  const Y = rome10.readUInt32LE(off);
  const H = rome10.readUInt32LE(off+4);
  const K = rome10.readUInt32LE(off+8);
  console.log('  ['+i+']@0x'+off.toString(16)+' Y='+Y+' H=0x'+H.toString(16).padStart(8,'0')+' K=0x'+K.toString(16).padStart(8,'0'));
}

// Try also alignment +1
console.log('\n=== rome10 at 0x51b6 (align +1) ===');
const r2 = walk(rome10, 0x51b6);
console.log('Records (raw walk):', r2.length);
for(let i=0;i<Math.min(10, r2.length); i++){
  const r = r2[i];
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' y='+r.y);
}

// Looking at the bytes 03 01 00 00 → 0x103 = 259, 0x103-0x100 = 3 (decimal). That
// could mean the "high byte" encodes something else (faction id?) and low byte
// encodes Y.
// Let's check the actual pattern. The raw bytes for first record are:
// 03 01 00 00  00 00 00 00  00 04 00 e6
// If we interpret as a single 12-byte record where:
//   bytes[0]=0x03 = Y
//   bytes[1]=0x01 = X? or some flag
//   bytes[8]=0x00, bytes[9]=0x04, bytes[10]=0x00, bytes[11]=0xe6
console.log('\n=== Bytewise interpretation ===');
for(let i=0;i<20;i++){
  const off = 0x51b5 + i*12;
  const bytes = Array.from(rome10.slice(off, off+12));
  console.log('  ['+i+']@0x'+off.toString(16)+' bytes='+bytes.map(b=>b.toString(16).padStart(2,'0')).join(' '));
}
