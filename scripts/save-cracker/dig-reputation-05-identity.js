// dig-reputation-05-identity.js
// Test whether u32 at rec+28 is a STABLE per-faction identity across the
// Spain turn saves. If stable, we can track each faction's record across
// turns and diff its body to find drifting scalars (reputation candidate).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = {
  T1:      'save_17-05-2026   Spain   Turn 1.sav',
  T2trade: 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav',
  T3end:   'save_Autosave   Spain   Turn 3 End.sav',
  T4start: 'save_Autosave   Spain   Turn 4 Start.sav',
  T4war:   'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav',
};

function findRecs(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    out.push({ off: i, id28: buf.readUInt32LE(i + 28), treasury: buf.readInt32LE(i), p44: buf.readUInt32LE(i + 44) });
  }
  return out;
}

const all = {};
for (const [tag, file] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path.join(BASE, file));
  all[tag] = findRecs(buf);
  console.log(`${tag}: ${all[tag].length} records`);
}

// Collect all distinct id28 values across all saves.
const ids = new Set();
for (const tag of Object.keys(all)) for (const r of all[tag]) ids.add(r.id28);
console.log(`\nDistinct id28 values across all saves: ${ids.size}`);

// For each id28, show how many saves contain it and its treasury sequence.
console.log('\nid28 -> presence + treasury sequence across turns:');
const tags = Object.keys(all);
let stableCount = 0;
for (const id of ids) {
  const row = [];
  let present = 0;
  for (const tag of tags) {
    const r = all[tag].find(x => x.id28 === id);
    if (r) { row.push(`${tag}=${r.treasury}`); present++; } else row.push(`${tag}=-`);
  }
  if (present === tags.length) stableCount++;
  console.log(`  0x${id.toString(16).padStart(8,'0')} [${present}/${tags.length}] ${row.join('  ')}`);
}
console.log(`\nStable (present in all ${tags.length}) ids: ${stableCount} / ${ids.size}`);
