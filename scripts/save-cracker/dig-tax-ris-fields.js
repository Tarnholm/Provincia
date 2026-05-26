// Map the RIS settlement stats block. RIS layout differs from Alexander:
// name appears once, default_set is +128 AFTER the name, pop@dx=-35.
// Find income / PO / level / tax in the RIS layout by cross-settlement
// consistency. Use a later-turn RIS save so income is populated.
//
// We dump, for each known settlement, every u32 in dx -300..-1 and look for:
//   - pop (known, dx=-35)
//   - income (hundreds..thousands, should differ from pop)
//   - PO (0..100)
//   - level (0..6)
//   - a 0..4 enum that's constant-ish (tax candidate)
//
// Read-only.

const fs = require('fs');
const path = require('path');
const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

const FILE = process.argv[2] || 'save_Autosave   Republic of Rome   Turn 4 End.sav';
const buf = fs.readFileSync(path.join(SAVE_DIR, FILE));
console.log('FILE:', FILE, 'size', buf.length);

function nameOcc(name) {
  const len = name.length;
  const t = Buffer.alloc(2 + len * 2);
  t.writeUInt16LE(len, 0);
  for (let i = 0; i < len; i++) t.writeUInt16LE(name.charCodeAt(i), 2 + i * 2);
  const out = []; let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { out.push(p); p++; }
  // keep only those followed by default_set within 200 bytes (settlement record)
  return out.filter(pos => {
    const ne = pos + 2 + len * 2;
    const ds = buf.indexOf(Buffer.from('default_set', 'ascii'), ne);
    return ds >= 0 && ds - ne < 200;
  });
}

const TARGETS = ['Rome', 'Capua', 'Arretium', 'Tarentum', 'Croton', 'Patavium', 'Athens', 'Corinth'];

// Collect per-dx values across settlements to find consistent fields.
const perDx = {}; // dx -> [{name, v}]
const records = [];
for (const name of TARGETS) {
  const occ = nameOcc(name);
  if (occ.length === 0) continue;
  const np = occ[0];
  records.push({ name, np });
}
console.log('records found:', records.map(r => r.name).join(', '));

for (const r of records) {
  for (let dx = -300; dx <= -1; dx++) {
    const o = r.np + dx;
    if (o < 0 || o + 4 > buf.length) continue;
    const v = buf.readUInt32LE(o);
    (perDx[dx] = perDx[dx] || []).push({ name: r.name, v });
  }
}

// Report dx where ALL records have a value in a plausible range for a field.
function fieldScan(label, lo, hi, maxAcross) {
  console.log(`\n=== candidate dx for ${label} (all in [${lo},${hi}]${maxAcross ? `, distinct<=${maxAcross}` : ''}) ===`);
  for (const dx of Object.keys(perDx).map(Number).sort((a, b) => a - b)) {
    const arr = perDx[dx];
    if (arr.length < records.length) continue;
    if (!arr.every(x => x.v >= lo && x.v <= hi)) continue;
    if (maxAcross) {
      const distinct = new Set(arr.map(x => x.v));
      if (distinct.size > maxAcross) continue;
    }
    console.log(`  dx=${dx}: ` + arr.map(x => `${x.name}=${x.v}`).join('  '));
  }
}

fieldScan('LEVEL (0..6)', 0, 6, null);
fieldScan('PO (0..100)', 0, 100, null);
fieldScan('TAX enum (0..4)', 0, 4, 5);
fieldScan('INCOME (50..50000)', 50, 50000, null);
