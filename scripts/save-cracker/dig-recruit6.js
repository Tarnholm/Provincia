// Show context around each Roma hit to identify the settlement record.
const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const buf = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));

const ROMA = Buffer.from([0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);
const hits = [];
let p = 0;
while (p < buf.length - ROMA.length) {
  const idx = buf.indexOf(ROMA, p);
  if (idx === -1) break;
  hits.push(idx);
  p = idx + 1;
}
console.log(`${hits.length} hits`);
for (const h of hits) {
  const before = buf.slice(Math.max(0, h-12), h).toString('hex');
  const after  = buf.slice(h, Math.min(buf.length, h+24)).toString('hex');
  const utf16  = buf.slice(h, h+30).toString('utf16le').replace(/[\x00-\x1f]/g,'.');
  console.log(`0x${h.toString(16).padStart(8,'0')}  before=${before}  after=${after}  text="${utf16}"`);
}
