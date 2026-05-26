// Full hex dump around a RIS settlement name to understand the record layout
// and locate income + tax. Show dx -120..+260 as u32/u8/float annotations.
//
// Read-only.

const fs = require('fs');
const path = require('path');
const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const FILE = process.argv[2] || 'save_Autosave   Republic of Rome   Turn 4 End.sav';
const NAME = process.argv[3] || 'Rome';
const buf = fs.readFileSync(path.join(SAVE_DIR, FILE));

function nameOcc(name) {
  const len = name.length;
  const t = Buffer.alloc(2 + len * 2);
  t.writeUInt16LE(len, 0);
  for (let i = 0; i < len; i++) t.writeUInt16LE(name.charCodeAt(i), 2 + i * 2);
  const out = []; let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    const ne = p + 2 + len * 2;
    const ds = buf.indexOf(Buffer.from('default_set', 'ascii'), ne);
    if (ds >= 0 && ds - ne < 200) out.push(p);
    p++;
  }
  return out;
}

const occ = nameOcc(NAME);
console.log(`${FILE}  ${NAME}: ${occ.length} settlement-record occurrences`);
const np = occ[0];
console.log(`name prefix @0x${np.toString(16)}`);

// Print byte rows of 16 from dx -128 to +272, with u32 LE annotation per row start.
for (let dx = -128; dx <= 272; dx += 16) {
  const o = np + dx;
  if (o < 0) continue;
  const bytes = Array.from(buf.slice(o, o + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  // ascii
  let asc = '';
  for (let i = 0; i < 16; i++) {
    const b = buf[o + i];
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.';
  }
  console.log(`dx=${String(dx).padStart(4)} 0x${o.toString(16)}: ${bytes}  |${asc}|`);
}

// Specifically: list u32 values in dx -64..+260 that look like income (denarii).
console.log('\nu32 scan dx -64..+260 (value 50..60000):');
for (let dx = -64; dx <= 260; dx++) {
  const o = np + dx;
  if (o < 0 || o + 4 > buf.length) continue;
  const v = buf.readUInt32LE(o);
  if (v >= 50 && v <= 60000) process.stdout.write(`[${dx}]=${v} `);
}
console.log('');
