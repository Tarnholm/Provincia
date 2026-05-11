// Dig gaps B and C deeper. Gap C has scripted events strings; gap B has fixed-stride records.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// === Gap C: 0x846d1..0xa8beb — scripted events table ===
console.log('=== Gap C: scripted events (0x846d1..0xa8beb) ===');
// First bytes: 02 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 08 00 76 6f 6c 63 61 6e 6f 00
//   At +0x15 = 21: u16 lenP1 = 0x0008 = 8, then "volcano\0" (7 chars + nul)
//   Then at +0x1d: u16 = 0x0015 = 21, then "eruption_at_etna_140\0" (20 chars + nul)
// Pattern: length-prefixed ASCII strings

// Find all length-prefixed strings:
const GAP_C_START = 0x846d1, GAP_C_END = 0xa8beb;
const strs = [];
let p = GAP_C_START;
while(p < GAP_C_END - 4){
  const lenP1 = buf.readUInt16LE(p);
  if(lenP1>=4 && lenP1<=64){
    const name = buf.slice(p+2, p+2+lenP1-1).toString('ascii');
    if(/^[a-z_][a-z_0-9]*$/i.test(name) && buf[p+2+lenP1-1]===0){
      strs.push({off:p, len:lenP1, name});
      p += 2 + lenP1;
      continue;
    }
  }
  p++;
}
console.log('Strings found:', strs.length);
// Unique
const uniq = new Map();
for(const s of strs){ uniq.set(s.name, (uniq.get(s.name)||0)+1); }
console.log('Distinct strings:', uniq.size);
const top = [...uniq.entries()].sort((a,b)=>b[1]-a[1]);
console.log('Top 30:');
top.slice(0,30).forEach(([n,c])=>console.log('  ['+c+'] '+n));

// Categorize
const categories = new Map();
for(const [n,c] of uniq){
  const cat = n.replace(/_\d+.*$/,'').replace(/_at_\w+$/,'').replace(/_\d+_\d+_ce$/,'');
  categories.set(cat, (categories.get(cat)||0)+c);
}
console.log('\nCategories (collapsed):');
[...categories.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([n,c])=>console.log('  ['+c+'] '+n));

// === Gap B: 0x87e9..0x846af — fixed stride records ===
console.log('\n=== Gap B: fixed-stride records (0x87e9..0x846af) ===');
const GAP_B_START = 0x87e9, GAP_B_END = 0x846af;
// pattern: 01 20 11 01 13 01 00 00 0b d1 22 ec — 12 bytes
// then 01 20 12 01 13 01 00 00 0b d1 22 ec — same first 8 + diff 4

// Look for stride
const candidates = [4,8,12,16,20,24,32];
for(const stride of candidates){
  // count how many positions have buf[p+0..stride-1] repeated
  let nMatches = 0;
  for(let p=GAP_B_START; p+stride<GAP_B_END; p+=stride){
    if(buf[p]===0x01 || buf[p]===0x02) nMatches++;
  }
  // doesn't really tell us. Let me just print first 200 bytes in stride view.
}

// Print as 12-byte records
console.log('First 30 12-byte records starting 0x87e9:');
for(let i=0;i<30;i++){
  const o = GAP_B_START + i*12;
  let line = '['+i+'] @0x'+o.toString(16)+': ';
  for(let j=0;j<12;j++) line += buf[o+j].toString(16).padStart(2,'0')+' ';
  console.log(line);
}
// Try 16-byte stride
console.log('\nFirst 30 16-byte records starting 0x87e9:');
for(let i=0;i<30;i++){
  const o = GAP_B_START + i*16;
  let line = '['+i+'] @0x'+o.toString(16)+': ';
  for(let j=0;j<16;j++) line += buf[o+j].toString(16).padStart(2,'0')+' ';
  console.log(line);
}
// Count how 12-byte records continue
let nStride12 = 0;
for(let p=GAP_B_START; p+12<=GAP_B_END; p+=12){
  if((buf[p]===0x01||buf[p]===0x02) && buf[p+1]===0x20 && buf[p+5]===0x01 && buf[p+6]===0x00 && buf[p+7]===0x00) nStride12++;
}
console.log('\n12-byte records matching {0x01|0x02,0x20,*,*,*,0x01,0x00,0x00}:', nStride12);
const expected12 = (GAP_B_END - GAP_B_START)/12;
console.log('Possible records at 12B stride:', expected12);

// What is the structure?
// 01 20 11 01 13 01 00 00 — header: byte 1 byte 2 then u16 record-id 0x0111, u16 0x0113, u16 0
// 0b d1 22 ec — u32 = 0xec22d10b (~3.95G — looks like a UUID/hash)
// So each record: u8 flag, u8 0x20, u16 idA, u16 idB, u16 0, u32 hash
// That's 12B.

// Count how many records start with 0x01/0x02 0x20:
let n0120 = 0, n0220 = 0, nOther = 0;
let firstNonStride = -1;
for(let i=0;i<expected12;i++){
  const o = GAP_B_START + i*12;
  if(buf[o]===0x01 && buf[o+1]===0x20) n0120++;
  else if(buf[o]===0x02 && buf[o+1]===0x20) n0220++;
  else { nOther++; if(firstNonStride<0) firstNonStride=i; }
}
console.log('Records at 12B stride starting 0x01,0x20:', n0120);
console.log('Records at 12B stride starting 0x02,0x20:', n0220);
console.log('Other:', nOther, 'first non-stride at index:', firstNonStride);

// What is the 24-bit hash distribution?
// idA values (u16 at +2..+3):
const idCounts = new Map();
for(let i=0;i<Math.min(expected12, 10000);i++){
  const o = GAP_B_START + i*12;
  const idA = buf.readUInt16LE(o+2);
  idCounts.set(idA, (idCounts.get(idA)||0)+1);
}
const top10 = [...idCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('Top 10 idA values:', top10);
console.log('Total distinct idA:', idCounts.size);
