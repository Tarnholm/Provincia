// dig-ai-policy8.js — search for the DIPLOMATIC_ATTITUDE / AI_SENATE_FACTION_DATA arrays
// Strategy: in vanilla Republic of Rome, look for a 21x21 (or 23x23) byte/u32 matrix
// that varies between T1 and T5.

const fs = require('fs');
const A = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');  // T5
const B = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav');  // T1

console.log('Searching for a 21x21 or 23x23 byte matrix that has small int values...');

// Vanilla Republic of Rome has 21 factions per descr_strat (4 roman + 17 others)
// or 22 including slave. Maybe 21*21 = 441 byte matrix.

// Look for a 441-byte region where bytes are all <= 7 (the diplomatic attitude enum)
// In RTW vanilla: 100/200/600 are the typical diplomatic-attitude values

// Actually attitudes range 0..1000 typically, stored as u8 or u16
// Test for 21x21 = 441 bytes window
console.log('\n441-byte windows in rome10 where most bytes are in 0..7 range:');
const W = 441;
const N = A.length;
for(let off=0;off<N-W;off++){
  // count bytes <=7
  let low = 0;
  for(let i=0;i<W;i++) if(A[off+i]<=7) low++;
  if(low/W > 0.97){
    // skip if all-zero
    let nonzero = 0;
    for(let i=0;i<W;i++) if(A[off+i]>0) nonzero++;
    if(nonzero>=15 && nonzero<=150){
      console.log('  off=0x'+off.toString(16)+': '+nonzero+' nonzero bytes (98%+ low ints)');
    }
  }
}

// Also try 21*21*4 = 1764 (u32 matrix) and 23*23 = 529 byte matrix
console.log('\n1764-byte windows (21x21 u32) where most u32 are 0..1000:');
const W2 = 1764;
for(let off=0;off<N-W2;off+=4){
  let low = 0, nonzero = 0;
  for(let i=0;i<W2;i+=4){
    const v = A.readUInt32LE(off+i);
    if(v<=1000) low++;
    if(v>0) nonzero++;
  }
  if(low === W2/4 && nonzero >= 30 && nonzero <= 400){
    console.log('  off=0x'+off.toString(16)+': '+nonzero+' nonzero u32 (all <= 1000)');
  }
}

// Even simpler approach: look for the specific descr_strat starting attitudes
// Romans_julii starts with 100 vs Brutii/Scipii/Senate (so 100 appears with high frequency at start)
// And 200 (default neutral) appears MOST
// And 600 (slave hostility) for most pairs
// A 21x21 matrix should have a typical signature: 8 entries with 100 (Roman family ties), 20 with 600 (slave)
// Search for a region with these counts
console.log('\nSearching for diplomatic matrices: u32 array with specific stats (count(100)=4-20, count(200)=50-200, count(600)=15-25):');
for(let off=0;off<N-W2;off+=4){
  let c100=0, c200=0, c600=0;
  for(let i=0;i<W2;i+=4){
    const v = A.readUInt32LE(off+i);
    if(v===100) c100++;
    else if(v===200) c200++;
    else if(v===600) c600++;
  }
  if(c100>=2 && c100<=20 && c200>=50 && c200<=300 && c600>=10 && c600<=30){
    console.log('  off=0x'+off.toString(16)+': c100='+c100+' c200='+c200+' c600='+c600);
  }
}

// And as bytes (treating attitudes as u8)
console.log('\nByte-level diplomatic matrix candidates (count100>=4, count200>=10):');
const W3 = 441;
for(let off=0;off<N-W3;off++){
  let c100=0, c200=0, c600=0;
  for(let i=0;i<W3;i++){
    if(A[off+i]===100) c100++;
    else if(A[off+i]===200) c200++;
  }
  if(c100>=2 && c200>=20 && c200<=200){
    if(c100<=15){
      console.log('  off=0x'+off.toString(16)+': c100='+c100+' c200='+c200);
    }
  }
}
