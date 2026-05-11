// Decode the 19/26/29-byte sections found in Macedon T97 save.
// They look like a list of small records following each other.

const fs = require('fs');

function probe(filePath) {
  const buf = fs.readFileSync(filePath);
  const name = filePath.split(/[\/\\]/).pop();
  console.log('\n=== ' + name + ' (' + buf.length + ') ===');

  // Walk all self-pointing sections in the file
  let p = 0x3a00;
  const sections = [];
  while (p + 8 <= buf.length) {
    let found = false;
    for (let scan = 0; scan < 10000 && p + scan + 8 <= buf.length; scan++) {
      const c = p + scan;
      const sp = buf.readUInt32LE(c);
      if (sp !== c) continue;
      const sz = buf.readUInt32LE(c + 4);
      if (sz < 12 || c + sz > buf.length) continue;
      sections.push({ off: c, sz, gap: scan });
      p = c + sz;
      found = true;
      break;
    }
    if (!found) break;
  }
  console.log('top-level sections:', sections.length);
  // Group by size
  const sizes = {};
  for (const s of sections) sizes[s.sz] = (sizes[s.sz] || 0) + 1;
  console.log('size distribution:', sizes);

  // For each small section, decode payload as a sequence of u32s
  // The body root would be the biggest. Let me find it
  const biggest = sections.reduce((a,b) => b.sz > a.sz ? b : a, { sz: 0 });
  console.log('biggest section: 0x' + biggest.off.toString(16), 'size:', biggest.sz);

  // For top-level small sections, decode
  console.log('\nfirst 5 sections decoded as u32 arrays:');
  for (const s of sections.slice(0, 5)) {
    const payload = [];
    for (let i = s.off + 8; i + 4 <= s.off + s.sz; i += 4) {
      payload.push(buf.readUInt32LE(i));
    }
    console.log(' 0x' + s.off.toString(16), 'size:', s.sz, 'u32s:', payload);
  }
}

probe('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');
probe('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 99 Start.sav');
probe('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_saveturn1start.sav');
probe('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_damagedturn1.sav');
