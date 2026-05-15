// Variant: stride-9 with bytes [p+4..p+8] forming pattern XX 00 00 00 00 where XX is a small constant per range.
const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const ranges = [
  [0x01818a3c, 0x01819324],
  [0x0181943c, 0x01819d24],
  [0x01819e3c, 0x0181a720],
  [0x0181a838, 0x0181b11c],
  [0x0156a262, 0x0156ab35],
  [0x0156ac4d, 0x0156b520],
  [0x01c43165, 0x01c43a36],
];

// Try: at stride 9, last 4 bytes are 0, byte[p+4] is some small constant.
for (const [s, e] of ranges) {
  let bestOff = -1, bestOk = 0, bestTotal = 0, bestConst = -1;
  for (let off = 0; off < 9; off++) {
    // Find dominant value of byte[p+4] across stride-9 stops in this range
    const counts = {};
    let total = 0;
    for (let p = s + off; p + 9 <= e; p += 9) {
      total++;
      const b4 = buf[p+4];
      const b3 = buf[p+3];
      if (buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0 &&
          (b3 & 0x0f) === 0 && b3 <= 0x80) {
        counts[b4] = (counts[b4]||0)+1;
      }
    }
    let topK = -1, topV = 0;
    for (const [k,v] of Object.entries(counts)) if (v > topV) { topV = v; topK = +k; }
    if (topV > bestOk) { bestOk = topV; bestTotal = total; bestOff = off; bestConst = topK; }
  }
  console.log(`0x${s.toString(16)} off=${bestOff} const=${bestConst} ${bestOk}/${bestTotal} = ${(100*bestOk/bestTotal).toFixed(1)}%`);
}
