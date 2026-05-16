const fs = require('fs');
const path = require('path');
const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const files = fs.readdirSync(BASE).filter(f => f.includes('Turn 13') || f.includes('Turn 14') || f.includes('Turn 15'));
for (const f of files) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const year = buf.readInt32LE(0x504);
  const ctr = buf.readUInt32LE(0xefd);
  console.log(f.padEnd(60), 'size=' + buf.length, 'year=' + year, 'ctr=' + ctr);
}
