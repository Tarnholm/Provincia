// dig-ai-policy6.js — find ANY repeated-stride array in player Macedon trailing data
// by searching for sequences of byte values that form regular patterns

const fs = require('fs');
const A = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');

const posA = 0x63a38, regsA = 25;
const trailStartA = posA + 52 + 4*regsA;
const trailLenA = 0x8ec33 - trailStartA;
console.log('Macedon trailing: 0x'+trailStartA.toString(16)+' .. 0x'+(trailStartA+trailLenA).toString(16),', size:', trailLenA);

// Search for arrays where:
// - first column is a u32 in {0..30} (faction-id like, since Alexander has 5 majors)
// - records have consistent format
// - >= 5 records (one per faction)

const candidateStrides = [4, 8, 12, 16, 20, 24, 28, 32, 40, 48];
for(const stride of candidateStrides){
  // For each potential start position, see if a 5-element array fits
  const arrayStarts = [];
  for(let off=0;off<trailLenA-stride*5;off+=4){
    const ids = [];
    for(let k=0;k<5;k++){
      const v = A.readUInt32LE(trailStartA+off+k*stride);
      ids.push(v);
    }
    // 'small int <= 30' AND distinct
    if(ids.every(v=>v<=30) && new Set(ids).size === 5){
      arrayStarts.push({off, ids});
    }
  }
  if(arrayStarts.length){
    console.log('\nSTRIDE='+stride+' — '+arrayStarts.length+' candidate 5-element arrays:');
    for(const a of arrayStarts.slice(0,5)){
      console.log('  trail+'+a.off+': first u32s = ['+a.ids.join(',')+']');
      // Dump full 5*stride bytes
      let raw = '    ';
      for(let i=0;i<5*stride && i<80;i++){
        raw += A[trailStartA+a.off+i].toString(16).padStart(2,'0')+' ';
        if((i+1)%stride===0) raw += '| ';
      }
      console.log(raw);
    }
  }
}

// Look for sentinel patterns ending an array - like 0xff 0xff 0xff 0xff before content drops
// Anywhere the bytes "[N] [0xff 0xff 0xff 0xff]" appear could be a count + sentinel
console.log('\nLooking for 0xff sentinels in trailing:');
let ffCount = 0;
for(let off=0;off<trailLenA-8;off++){
  if(A.readUInt32LE(trailStartA+off) === 0xffffffff && A.readUInt32LE(trailStartA+off+4) === 0xffffffff){
    if(ffCount<10) console.log('  trail+'+off+': u32(ff)+u32(ff). prev u32 = '+ (off>=4 ? A.readUInt32LE(trailStartA+off-4) : '?'));
    ffCount++;
  }
}
console.log('total double-ffu32: '+ffCount);
