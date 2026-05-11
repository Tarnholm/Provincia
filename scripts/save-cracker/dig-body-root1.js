// Task 2: Body root walk for rome10 RIS imperial
// Find body root start, walk direct children, catalog them by record-shape.
// Identify unmapped sections (not character_paths, not settlement records).

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);
console.log('Save size:', buf.length.toString(16));

// HST starts at ~0x3328 (per dossier). Body root starts somewhere in [0x3b00..0x3c00].
// Search for the first u32 self-pointer (i.e. value at offset == offset) starting after 0x3a00.
console.log('\nSearch for body root self-pointer 0x3a00..0x4000:');
for(let off=0x3a00; off<0x4000; off+=4){
  const v = buf.readUInt32LE(off);
  if(v === off){
    const size = buf.readUInt32LE(off+4);
    console.log('  candidate body root @', off.toString(16), 'size=', size.toString(16), 'extends to', (off+size).toString(16));
  }
}

// Per dossier, body root is at ~0x3bad. Let's check that area.
console.log('\nBytes around 0x3b90..0x3bc0:');
for(let off=0x3b90; off<0x3bc0; off++){
  process.stdout.write(buf[off].toString(16).padStart(2,'0')+' ');
  if((off-0x3b90)%16===15) process.stdout.write('\n');
}
console.log();

// Try every offset in 0x3b00..0x3c00 for a self-pointer.
console.log('\nByte-level self-pointer scan 0x3b00..0x3c00:');
for(let off=0x3b00; off<0x3c00; off++){
  if(off+4 > buf.length) break;
  const v = buf.readUInt32LE(off);
  if(v === off){
    const size = buf.readUInt32LE(off+4);
    console.log('  byte-aligned self-pointer @', off.toString(16), 'next u32=', size.toString(16), 'extends to', (off+size).toString(16));
  }
}

// Brief said body root at ~0x3bad — that's only odd-byte-aligned but a self-pointer
// in a section grammar uses unaligned reads possibly. Let's check raw bytes.
console.log('\nBytes at 0x3ba0..0x3bc0 with annotation:');
let s='';
for(let off=0x3ba0; off<0x3bc0; off++){
  s += buf[off].toString(16).padStart(2,'0')+' ';
}
console.log(s);

// What's at 0x3328?  HST start. What's the HST end?
console.log('\n--- HST scan ---');
// HST is a string table with len-prefixed UTF-16 names. Let's find the highest
// HST entry end. The dossier says "HST 0x3328..0x3b97".
// First u16 at 0x3328:
const hstStart = 0x3328;
console.log('HST first u16:', buf.readUInt16LE(hstStart));
// scan HST entries
let p = hstStart;
let count = 0;
while(p < 0x3c00 && count < 130){
  const lenP1 = buf.readUInt16LE(p);
  if(lenP1 < 2 || lenP1 > 100) break;
  const nameLen = lenP1 - 1;
  // name is ASCII not UTF-16 per dossier; check
  const name = buf.slice(p+2, p+2+nameLen).toString('ascii');
  if(!/^[A-Z_][A-Z_0-9]*$/.test(name)) break;
  // next byte is 0 then a u8 (version) then maybe more
  // Per dossier "u16 lenPlus1, ASCII name, u8 NUL, u32 version" but actual layout varies
  const versionByte = buf[p+2+nameLen+1];
  count++;
  if(count<=5 || count>=98) console.log(' HST['+count+'] @'+p.toString(16)+' name='+name+' versionByte='+versionByte);
  // move past
  p = p + 2 + nameLen + 1 + 4; // u16 + name + nul + u32?
  // Try alternate: actually +2 + lenP1 + 4 (lenP1 already includes nul)
}
console.log('HST entries found:', count, 'ended at', p.toString(16));
