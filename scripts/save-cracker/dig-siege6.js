// dig-siege6.js
// Dump 1KB of context around 0x12d8724 (the 4-byte ref in save_8) to
// identify the parent record (probably a settlement).
// Dump 1KB of context around 0x152f529 (the 13-byte siege header in save_8)
// to identify what type of section it belongs to.

const fs = require('fs');
const path = require('path');
const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const s8 = fs.readFileSync(path.join(SAVES_DIR,'save_8.1.sav'));
const s9 = fs.readFileSync(path.join(SAVES_DIR,'save_9.1.sav'));

function hex(buf, off, n=64) {
  const s=[];
  for (let i=0;i<n && off+i<buf.length;i++){
    s.push(buf[off+i].toString(16).padStart(2,'0'));
    if ((i+1)%16===0) s.push('\n');
  }
  return s.join(' ');
}
function ascii(buf, off, n=64) {
  let s=''; for (let i=0;i<n && off+i<buf.length;i++){ const b=buf[off+i]; s+=(b>=32 && b<127)?String.fromCharCode(b):'.'; }
  return s;
}

console.log('--- 1KB context around 0x12d8724 (the 4-byte siege ref) in save_8 ---');
console.log(hex(s8, 0x12d8724 - 512, 1024));
console.log('\n--- ASCII near 0x12d8724 ---');
console.log(ascii(s8, 0x12d8724 - 512, 1024));

console.log('\n\n--- 1KB context around 0x152f529 (the 13-byte siege header) in save_8 ---');
console.log(hex(s8, 0x152f529 - 512, 1024));
console.log('\n--- ASCII near 0x152f529 ---');
console.log(ascii(s8, 0x152f529 - 512, 1024));
