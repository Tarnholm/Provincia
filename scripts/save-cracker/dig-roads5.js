// Greedy walk past the first big section
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

// Section [0] ends at 0x633bb3
// Section [next] might be in the settlement zone or further along
let p = 0x633bb3;
const sections = [];
while (p + 8 <= buf.length) {
  let found = false;
  for (let scan = 0; scan < 1000000 && p + scan + 8 <= buf.length; scan++) {
    const c = p + scan;
    const sp = buf.readUInt32LE(c);
    if (sp !== c) continue;
    const sz = buf.readUInt32LE(c + 4);
    if (sz < 16 || c + sz > buf.length) continue;
    sections.push({ off: c, sz, gap: scan });
    p = c + sz;
    found = true;
    break;
  }
  if (!found) break;
}
console.log('top-level sections after 0x633bb3:', sections.length);
for (const s of sections) {
  console.log(' 0x' + s.off.toString(16), 'size:', s.sz.toString().padStart(10), 'gap:', s.gap, 'ends:', '0x' + (s.off + s.sz).toString(16), 'peek:', buf.slice(s.off+8, s.off+32).toString('hex'));
}

// Now look at what's between sections - examine after second top-level section if any
// What about descending into the settlement zone wrapper?
console.log('\nWhere does the file end?', '0x' + buf.length.toString(16), '=', buf.length, 'bytes');
