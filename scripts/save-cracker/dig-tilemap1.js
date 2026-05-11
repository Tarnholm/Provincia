// dig-tilemap1.js — examine the structure at the start of the 9.78MB "gap" region (~0x633bb3)
// Look for headers, recognize tile-grid shape, find Rome (285,404) byte pattern
const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(path);
console.log('file size:', buf.length, 'path:', path);

const GAP_START = 0x633bb3;
const GAP_END = 0xf88637;
const GAP_SIZE = GAP_END - GAP_START;
console.log('gap range:', '0x'+GAP_START.toString(16), '..', '0x'+GAP_END.toString(16), 'size:', GAP_SIZE);

// Dump first 256 bytes of gap as hex + interpret as u32s
const previewLen = 256;
const preview = buf.slice(GAP_START, GAP_START + previewLen);
console.log('\nfirst', previewLen, 'bytes of gap (hex):');
for(let i = 0; i < previewLen; i += 16){
  let line = '0x' + (GAP_START+i).toString(16).padStart(8,'0') + '  ';
  for(let j=0;j<16;j++) line += preview[i+j].toString(16).padStart(2,'0') + ' ';
  line += ' ';
  for(let j=0;j<16;j++) line += (preview[i+j]>=32 && preview[i+j]<127) ? String.fromCharCode(preview[i+j]) : '.';
  console.log(line);
}

console.log('\nfirst 32 u32le values:');
for(let i=0;i<32;i++){
  const off = GAP_START + i*4;
  const v = buf.readUInt32LE(off);
  console.log('  +' + (i*4).toString().padStart(4) + '  @0x' + off.toString(16) + '  = ' + v + ' (0x' + v.toString(16) + ')');
}

// Look at last 256 bytes
console.log('\nLAST 256 bytes of gap:');
for(let i=0;i<256;i+=16){
  const off = GAP_END - 256 + i;
  let line = '0x' + off.toString(16).padStart(8,'0') + '  ';
  for(let j=0;j<16;j++) line += buf[off+j].toString(16).padStart(2,'0') + ' ';
  console.log(line);
}

// Scan for runs of non-zero bytes (each "feature" cluster)
console.log('\nfirst 30 non-zero byte positions in gap:');
let count=0;
for(let i = GAP_START; i < GAP_END && count<30; i++){
  if(buf[i] !== 0){
    console.log('  @0x' + i.toString(16) + ' (off+' + (i-GAP_START) + '): val=0x' + buf[i].toString(16));
    count++;
  }
}
