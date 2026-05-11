// Find all top-level "big" sections in the file - greedy walk from HST_END.
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

const HST_END = 0x3a00; // approximate

// Walk top-level sections (consume size at each)
let p = HST_END;
const sections = [];
while (p + 8 <= buf.length) {
  // Try to find next self-pointer
  let found = false;
  for (let scan = 0; scan < 100000 && p + scan + 8 <= buf.length; scan++) {
    const candidate = p + scan;
    const sp = buf.readUInt32LE(candidate);
    if (sp !== candidate) continue;
    const sz = buf.readUInt32LE(candidate + 4);
    if (sz < 16 || candidate + sz > buf.length) continue;
    // accept this section
    sections.push({ off: candidate, sz, gap: scan });
    p = candidate + sz;
    found = true;
    break;
  }
  if (!found) break;
}
console.log('top-level sections:', sections.length);
console.log('first 30 sections:');
for (let i = 0; i < Math.min(30, sections.length); i++) {
  const s = sections[i];
  console.log(' [' + i + '] 0x' + s.off.toString(16), 'size:', s.sz.toString().padStart(10), 'gap:', s.gap, 'peek:', buf.slice(s.off+8, s.off+24).toString('hex'));
}
console.log('\nlast 10 sections:');
for (const s of sections.slice(-10)) {
  console.log(' 0x' + s.off.toString(16), 'size:', s.sz.toString().padStart(10), 'peek:', buf.slice(s.off+8, s.off+24).toString('hex'));
}

// Find sections sorted by size
const bySize = [...sections].sort((a,b) => b.sz - a.sz);
console.log('\ntop 15 biggest sections:');
for (const s of bySize.slice(0, 15)) {
  console.log(' 0x' + s.off.toString(16), 'size:', s.sz.toString().padStart(10), 'ends at 0x' + (s.off + s.sz).toString(16));
}
