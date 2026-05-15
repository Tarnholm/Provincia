// Check the remaining top-7 unknowns for stride-9 alignment too.
const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const ranges = [
  [0x01818a3c, 0x01819324, 2280],
  [0x0181943c, 0x01819d24, 2280],
  [0x01819e3c, 0x0181a720, 2276],
  [0x0181a838, 0x0181b11c, 2276],
  [0x0156a262, 0x0156ab35, 2259],
  [0x0156ac4d, 0x0156b520, 2259],
  [0x01c43165, 0x01c43a36, 2257],
];

for (const [s, e] of ranges) {
  let best = -1, bestCount = 0, bestTotal = 0;
  for (let off = 0; off < 9; off++) {
    let ok = 0, total = 0;
    for (let p = s + off; p + 9 <= e; p += 9) {
      total++;
      const b3 = buf[p+3];
      if (buf[p+4]===0 && buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0 &&
          (b3 & 0x0f) === 0 && b3 <= 0x80) ok++;
    }
    if (ok > bestCount) { bestCount = ok; bestTotal = total; best = off; }
  }
  console.log(`0x${s.toString(16)} off=${best} ${bestCount}/${bestTotal} = ${(100*bestCount/bestTotal).toFixed(1)}%`);
  // Show first 32 bytes
  let hex='';
  for(let i=0;i<32;i++) hex += buf[s+i].toString(16).padStart(2,'0')+' ';
  console.log(`  first32: ${hex}`);
}
