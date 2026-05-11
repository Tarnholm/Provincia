// dig-tilemap5.js — verify 36582 records / 267-byte stride across multiple saves and campaigns
const fs = require('fs');

const candidates = [
  // Rome / Republic of Rome campaign (vanilla)
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav',
  // Alexander
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav',
  'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 99 Start.sav',
];

for(const path of candidates){
  try {
    const buf = fs.readFileSync(path);
    // Find gap by scanning for the end of the body root section.
    // We need to find: first section after HST is the body root at ~0x3b9X with self-pointer.
    // Walk to find a 9-MB region between body root end and the settlement zone.
    // Easier: find "0x05" at exactly the FIRST_CLUSTER_OFFSET pattern from session 12.

    // From session 12: gap starts at 0x633bb3 in rome10. Let's locate the gap dynamically.
    // The body root is at 0x3b99 with size ~6488090 in rome10 (varies per-save).
    // Read self-pointer at 0x3b99 to find body root and size at 0x3b9d.

    // Try the canonical offset region around (file_size - 9.78MB - 16.29MB - 6.31MB) just to validate
    // Easier: scan for the first instance of "00 00 00 00 00 00 00 05 00 00 00 00 00 00 00 00 00 00 00 0a 00 00 00 c8 00 00 00 c8 00 00 00 02 00 00 00 06 00 00 00 c8" — the signature of a record-0
    const sig = Buffer.from([0x05,0,0,0,0,0,0,0,0,0,0,0,0x0a,0,0,0,0xc8,0,0,0,0xc8,0,0,0,0x02,0,0,0,0x06,0,0,0,0xc8]);
    let foundAt = buf.indexOf(sig);

    console.log('\n==='+path.split('/').pop()+' ===');
    console.log('  file size:', buf.length);
    if(foundAt < 0){
      console.log('  signature NOT found');
      continue;
    }
    console.log('  first signature @ 0x'+foundAt.toString(16));

    // Walk stride=267 from there
    let n = 0;
    let pos = foundAt;
    while(buf.length > pos + 97 && buf[pos] === 0x05 && buf[pos+12] === 0x0a){
      n++;
      pos += 267;
    }
    console.log('  consecutive records w/ stride 267:', n);
    // Also count more loosely: how many positions have 0x05 at start of a stride
    let totalRec = 0;
    pos = foundAt;
    while(pos < buf.length){
      if(buf[pos] === 0x05) totalRec++;
      else if(buf[pos] !== 0) break;  // hit something unexpected
      pos += 267;
    }
    console.log('  total records (loose): ', totalRec);

    // Gap end (= last record + 267):
    const gapEnd = foundAt - 157 + n * 267;  // first record starts at foundAt - 157 (the cluster prefix)
    console.log('  gap end candidate:', '0x'+gapEnd.toString(16));
  } catch(e){
    console.log('skipping', path, ':', e.message);
  }
}
