// HST starts at 0x3314 in rome10. Parse it properly.
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

const HST_START = 0x3314;
const HST_END = 0x4000;
let pos = HST_START;
const hst = [];
while (pos < HST_END) {
  const sStart = pos;
  while (pos < HST_END && buf[pos] !== 0) pos++;
  if (pos >= HST_END) break;
  const name = buf.slice(sStart, pos).toString('utf8');
  pos++; // skip NUL
  if (pos + 4 > HST_END) break;
  const v = buf.readUInt32LE(pos);
  pos += 4;
  if (name === '' || v > 100) break;
  if (!/^[A-Z_]/.test(name)) break;
  hst.push({ name, v, off: sStart });
}
console.log('HST entries:', hst.length);
// Filter for road/path/map/tile/trade related
const interesting = hst.filter(e => /ROAD|PATH|MAP|TILE|TERRA|TRADE|RESOURCE|BATTLE|HIST|LOG|EVENT|REGION/i.test(e.name));
console.log('\ninteresting HST entries:');
for (const e of interesting) console.log(' ', e.name.padEnd(40), 'v=' + e.v);
console.log('\n\nFull HST list:');
for (const e of hst) console.log(' ', e.name.padEnd(40), 'v=' + e.v);
