// dig-cpool-2.js — Session 106 / 2
// Decompose the 261 KB zone into culture-pool records.
// Walk the zone forward, finding (u16 strLen) (ASCII bytes) pattern; each record is one culture name pool.
// Cross-validate sizes against turn-progression saves.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVES = [
  'save_10_fresh.sav',
  'save_1.2.sav',
  'ror_t1e.sav',
  'ror_t2s.sav',
  'ror_t5.sav',
  'ror_t11s.sav',
  'ror_t11e.sav',
  'athens_t21.sav',
  'athens_t22e.sav',
];

const ZONE_REL_START = 0x0c400;
const ZONE_REL_END = 0x4d000;

// Walk a buffer in stride-4, looking for `<u16 strLen> <ASCII bytes>` patterns where strLen is sane.
function walkPoolRecords(zone, maxLen) {
  const found = [];
  // Allow strings between 3 and 30 chars
  for (let i = 0; i + 32 < maxLen; i += 1) {
    const strLen = zone.readUInt16LE(i);
    if (strLen < 3 || strLen > 30) continue;
    if (i + 2 + strLen > maxLen) continue;
    // Check next strLen bytes are ASCII printable
    let ok = true;
    let txt = '';
    for (let j = 0; j < strLen; j++) {
      const b = zone[i + 2 + j];
      if (b < 0x20 || b >= 0x7f) {
        if (j === strLen - 1 && b === 0) {
          // trailing null allowed
        } else {
          ok = false;
          break;
        }
      }
      txt += String.fromCharCode(b);
    }
    if (!ok) continue;
    // Must contain at least one letter
    if (!/[a-zA-Z]/.test(txt)) continue;
    // Must look like a name-pool key: underscored, lowercase
    if (!/_men|_women|_surnames/.test(txt) && !['barbarian','greek','eastern','egyptian','roman','carthaginian','nomad','parthian','blank'].includes(txt.replace(/\0/g,''))) {
      continue;
    }
    found.push({ off: i, strLen, text: txt.replace(/\0/g,'') });
  }
  return found;
}

const allResults = {};

for (const saveName of SAVES) {
  console.log(`\n=== ${saveName} ===`);
  const buf = fs.readFileSync(path.join(FIX, saveName));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const zone = buf.slice(REC + ZONE_REL_START, REC + ZONE_REL_END);
  console.log(`  Player rec abs=0x${REC.toString(16)} size=${player.size} zone size=${zone.length}`);

  const recordsFound = walkPoolRecords(zone, zone.length);
  console.log(`  Pool records (strings matching pool/culture keys): ${recordsFound.length}`);
  // List first 8 and last 8
  for (const r of recordsFound.slice(0, 12)) {
    console.log(`    zone+0x${r.off.toString(16).padStart(5,'0')}  strLen=${r.strLen}  "${r.text}"`);
  }

  // Compute record sizes (delta between consecutive offsets)
  let totalBytes = 0;
  const sizes = [];
  for (let i = 1; i < recordsFound.length; i++) {
    sizes.push({ from: recordsFound[i-1].text, to: recordsFound[i].text, delta: recordsFound[i].off - recordsFound[i-1].off });
    totalBytes += recordsFound[i].off - recordsFound[i-1].off;
  }
  console.log(`  Record size distribution (first 10):`);
  for (const s of sizes.slice(0, 10)) {
    console.log(`    ${s.from} -> ${s.to}: delta=${s.delta}`);
  }

  allResults[saveName] = {
    zoneSize: zone.length,
    poolRecordsCount: recordsFound.length,
    records: recordsFound.map(r => ({ off: r.off, strLen: r.strLen, text: r.text })),
  };
}

// Compare turn progression: do the number of records change?
console.log('\n=== Cross-save comparison ===');
console.log('save                              poolRecs  zoneSize  first→last gap');
for (const sv of SAVES) {
  const r = allResults[sv];
  const last = r.records.length ? r.records[r.records.length - 1].off : 0;
  const first = r.records.length ? r.records[0].off : 0;
  console.log(`${sv.padEnd(35)} ${String(r.poolRecordsCount).padStart(4)}   ${r.zoneSize}  zone+0x${first.toString(16)} → zone+0x${last.toString(16)} (=${last-first} B)`);
}

// Compare list of culture/pool record NAMES across saves
console.log('\n=== Pool record names per save (counts by name) ===');
const allNames = new Set();
for (const sv of SAVES) for (const r of allResults[sv].records) allNames.add(r.text);
// Compute count per save per name
const nameRows = [];
for (const name of allNames) {
  const row = { name };
  for (const sv of SAVES) {
    row[sv] = allResults[sv].records.filter(r => r.text === name).length;
  }
  nameRows.push(row);
}
nameRows.sort((a, b) => a.name.localeCompare(b.name));
console.log('name'.padEnd(28) + SAVES.map(s => s.replace('.sav','').slice(0,10).padStart(11)).join(''));
for (const row of nameRows) {
  console.log(row.name.padEnd(28) + SAVES.map(s => String(row[s]).padStart(11)).join(''));
}

// Dump JSON
fs.writeFileSync(path.join(__dirname, 'out-cpool-2.json'), JSON.stringify(allResults, null, 2));
console.log('\nWrote out-cpool-2.json');
