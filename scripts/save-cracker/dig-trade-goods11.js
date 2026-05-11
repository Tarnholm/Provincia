// Found cluster of flipped Y resource matches around 0xa8cb8.
// Look at the structure near it - what's actually there?

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));
const MAP_H = 700;
const resSet = new Map();
for (const region of Object.keys(res)) {
  for (const r of res[region]) {
    resSet.set(r.x + ',' + r.y, { region, type: r.type, amount: r.amount });
  }
}

// Dump 1KB around 0xa8c00
const start = 0xa8c00;
const end = 0xa9400;
console.log('Hex dump 0x' + start.toString(16) + '..0x' + end.toString(16));
for (let i = start; i < end; i += 16) {
  let line = i.toString(16).padStart(8, '0') + ': ';
  for (let j = 0; j < 16 && i+j < end; j++) {
    line += buf[i+j].toString(16).padStart(2, '0') + ' ';
  }
  line += ' | ';
  for (let j = 0; j < 16 && i+j < end; j++) {
    const c = buf[i+j];
    line += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
  }
  console.log(line);
}

// Also try walking u32 records in this region looking for (X, Y) pairs
console.log('\nWalking u32 record at 0xa8cb8:');
for (let i = 0xa8cb8; i < 0xa9000; i += 4) {
  const x = buf.readUInt32LE(i);
  const y = buf.readUInt32LE(i+4);
  if (x > 0 && x < 1500 && y > 0 && y < 1500) {
    const mFlipped = resSet.get(x + ',' + (MAP_H - y));
    const mRaw = resSet.get(x + ',' + y);
    if (mFlipped || mRaw) {
      console.log(' 0x' + i.toString(16), 'x:', x, 'y:', y, '|', mRaw ? ('raw=' + JSON.stringify(mRaw)) : '', mFlipped ? ('flipped=' + JSON.stringify(mFlipped)) : '');
    }
  }
}
