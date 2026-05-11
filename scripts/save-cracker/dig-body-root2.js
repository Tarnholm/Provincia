// Body root walk: enumerate top-level children in rome10 RIS imperial save
// Body root at 0x3b99 size 0x63001a -> 0x3b99..0x633bb3

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const ROOT_OFF = 0x3b99;
const ROOT_SIZE = 0x63001a;
const ROOT_END = ROOT_OFF + ROOT_SIZE; // 0x633bb3

console.log('Body root @0x'+ROOT_OFF.toString(16)+' size=0x'+ROOT_SIZE.toString(16)+' end=0x'+ROOT_END.toString(16));

// Section grammar (taw): each section has {u32 self_ptr_eq_pos, u32 size, ...content...}
// Some sections in this engine have a different shape per session 12:
//   +0 u32 self-ptr, +4 u32 size, +8 u32 size-20, +12 u32 count, +16 u32 X_first, ...
// But the body root itself is the first section.
// At 0x3b99: u32=0x3b99 (self), u32=0x63001a (size). Then content from 0x3ba1 to 0x633bb3.

// Now walk children inside the body-root payload.
// First, after body root header (0x3b99 + 8 = 0x3ba1), the next child starts.
// But the bytes at 0x3ba1 are "00 1a 00 63" — that's "\0\x1a\0c" — start of a UTF-16 string?
// Per session 12 dump: 0x3ba1 onward has UTF-16LE 'campaign/imperial'... So the body root
// contents start with a string. Let me check.

console.log('\nBytes 0x3ba1..0x3c20 as hex:');
let s='';
for(let off=0x3ba1; off<0x3c40; off++){
  s += buf[off].toString(16).padStart(2,'0')+' ';
  if((off-0x3ba1+1)%16===0) s+='\n';
}
console.log(s);

console.log('\nUTF-16 string scan 0x3ba1..0x3c40:');
for(let off=0x3ba1; off<0x3c40-1; off++){
  // try u16 lenP1
  const lenP1 = buf.readUInt16LE(off);
  if(lenP1>=2 && lenP1<=80){
    // try UTF-16LE
    const utf = buf.slice(off+2, off+2+(lenP1-1)*2).toString('utf16le');
    if(/^[a-zA-Z_\/. ][a-zA-Z_\/. 0-9]*$/.test(utf)){
      console.log(' utf16 @'+off.toString(16)+' lenP1='+lenP1+' name='+utf);
    }
  }
}

// Actually per session 12 we know body root contains records of shape:
//   +0  u32 self-pointer
//   +4  u32 record size
//   ...
// Let's scan for next self-pointer after 0x3b99:
console.log('\nSelf-pointer scan in body root (0x3ba0..0x10000):');
let lastSP = 0x3b99;
let nFound = 0;
for(let off=0x3ba0; off<0x10000 && nFound<30; off++){
  const v = buf.readUInt32LE(off);
  if(v === off){
    const sz = buf.readUInt32LE(off+4);
    if(sz>20 && sz<0x800000 && off+sz<=ROOT_END+10){
      console.log(' SP @0x'+off.toString(16)+' size=0x'+sz.toString(16)+' (dec '+sz+') end=0x'+(off+sz).toString(16));
      nFound++;
    }
  }
}
