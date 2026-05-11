// dig-tilemap6.js — interpret each 267-byte record as u32 fields; analyze variation across records
const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(path);
const GAP_START = 0x633bb3, GAP_END = 0xf88637;
const STRIDE = 267;
const FIRST_REC_OFF = GAP_START + 157;  // first cluster
// records continue until... let's count properly
const RECORD_BYTES = 97;

let recordCount = 0;
{
  let p = FIRST_REC_OFF;
  while(p + STRIDE <= GAP_END){
    // does this position start with 0x05?
    if(buf[p] !== 0x05) break;
    recordCount++;
    p += STRIDE;
  }
}
console.log('records found:', recordCount);
console.log('total bytes used:', recordCount * STRIDE + 157);  // 157 is the leading zero prefix
console.log('total gap:', GAP_END - GAP_START);
console.log('trailing bytes:', GAP_END - (FIRST_REC_OFF + recordCount * STRIDE));

// Now read u32 fields at each offset for record 0 vs many records
const u32Offsets = [0,4,8,12,16,20,24,28,32,36,40,44,48,52,56,60,64,68,72,76,80,84,88,92];
console.log('\nValue histogram for each u32 field:');
const fieldHists = u32Offsets.map(()=>new Map());

for(let n=0;n<recordCount;n++){
  const base = FIRST_REC_OFF + n*STRIDE;
  for(let fi=0;fi<u32Offsets.length;fi++){
    const v = buf.readUInt32LE(base + u32Offsets[fi]);
    fieldHists[fi].set(v, (fieldHists[fi].get(v) || 0) + 1);
  }
}

for(let fi=0;fi<u32Offsets.length;fi++){
  const off = u32Offsets[fi];
  const h = fieldHists[fi];
  const entries = [...h.entries()].sort((a,b)=>b[1]-a[1]);
  const topN = entries.slice(0,5);
  let s = 'u32+' + String(off).padStart(2) + ': uniques=' + h.size + ' top: ';
  for(const [v,c] of topN) s += v + '(' + c + ') ';
  console.log('  '+s);
}

// also try u16
console.log('\nU16 field histogram (first 100 bytes of record):');
const u16Hists = [];
for(let off=0;off<RECORD_BYTES-1;off+=2){
  const h = new Map();
  for(let n=0;n<Math.min(recordCount,10000);n++){
    const base = FIRST_REC_OFF + n*STRIDE;
    const v = buf.readUInt16LE(base + off);
    h.set(v, (h.get(v) || 0) + 1);
  }
  u16Hists.push({off, h});
}
for(const {off,h} of u16Hists){
  if(h.size === 1) continue;
  const entries = [...h.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  let s = 'u16+' + String(off).padStart(2) + ': uniques=' + h.size + ' top: ';
  for(const [v,c] of entries) s += v + '(' + c + ') ';
  console.log('  '+s);
}

// Now check: are there 'spatial' patterns? Let's see what value at +28 ('6' constant) for the first few records that DIFFER
const variantOffsets = [16,20,24,28,32];
console.log('\nFirst 20 records showing varying field values:');
console.log('idx     +16   +20   +24   +28   +32');
for(let n=0;n<recordCount && n<60000;n++){
  const base = FIRST_REC_OFF + n*STRIDE;
  const a = buf.readUInt32LE(base+16);
  const b = buf.readUInt32LE(base+20);
  const c = buf.readUInt32LE(base+24);
  const d = buf.readUInt32LE(base+28);
  const e = buf.readUInt32LE(base+32);
  // print only first 20 'variant' records
  if(!(a===200 && b===200 && c===2 && d===6 && e===200)){
    console.log(String(n).padStart(5)+'  '+String(a).padStart(5)+' '+String(b).padStart(5)+' '+String(c).padStart(5)+' '+String(d).padStart(5)+' '+String(e).padStart(5));
  }
}
