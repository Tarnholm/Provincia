// dig-unit-army-link.js
// Confirm army grouping = consecutive file-order run (general + members, same
// region) AND look for an explicit shared army-uuid in the container trailer.
//
// 1. Segment units into armies by the rule: a new army begins at a general OR a
//    region change. Print army membership for the first ~12 armies.
// 2. For each army, check whether its units share a u32 value somewhere in the
//    container trailer (after the soldier array) = army back-pointer.
// 3. Check the general's commanderUuid vs the bytes after the soldier array of
//    its member units.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const recs = findUnitRecords(buf).sort((a, b) => a.offset - b.offset);

// Segment into armies: new army when this unit is a general/bodyguard with a
// commanderUuid, OR region changes from previous.
function isLeader(r) {
  return r.commanderUuid != null && (/general|bodyguard|captain/.test(r.name));
}
const armies = [];
let cur = null;
for (const r of recs) {
  const newArmy = !cur || isLeader(r) || r.region !== cur.region;
  if (newArmy) { cur = { region: r.region, leader: isLeader(r) ? r : null, units: [] }; armies.push(cur); }
  cur.units.push(r);
}
console.log(`Segmented ${recs.length} units into ${armies.length} groups (general/region rule)`);
console.log('\n=== First 14 groups ===');
for (const a of armies.slice(0, 14)) {
  const lead = a.leader ? `GEN(cmdr=${a.leader.commanderUuid})` : 'no-general';
  console.log(`  [${a.region}] ${lead} -> ${a.units.length} units: ${a.units.map(u => u.name.replace('roman ', '')).join(', ')}`);
}

// Group-size distribution
const sizeHist = {};
for (const a of armies) sizeHist[a.units.length] = (sizeHist[a.units.length] || 0) + 1;
console.log('\nGroup-size histogram:', JSON.stringify(sizeHist));
console.log(`Groups with a general: ${armies.filter(a => a.leader).length}`);
console.log(`Groups without (garrison/rebel stacks): ${armies.filter(a => !a.leader).length}`);

// For one multi-unit army with a general, look for a shared army-uuid:
// scan each member's container trailer (the 0xff run end + a bit) for a u32 that
// equals the general's commanderUuid or another shared value.
function regionTermEnd(r) {
  const ne = r.offset + 2 + Buffer.from(r.name, 'ascii').length;
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    let ok = true, nm = '';
    for (let j = rs; j < re; j += 2) { if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; } nm += String.fromCharCode(buf[j]); }
    if (!ok || nm !== r.region) continue;
    return re + 4;
  }
  return null;
}

const army = armies.find(a => a.leader && a.units.length >= 5 && a.region === 'Etruria');
if (army) {
  console.log(`\n=== Deep look at Etruria army (general cmdr=${army.leader.commanderUuid}) ===`);
  // For each unit, dump 48 bytes AFTER its record (the trailer between this unit
  // and the next) since the back-pointer to army/general likely lives there.
  for (const u of army.units) {
    const next = recs[recs.indexOf(u) + 1];
    const end = next ? next.offset : u.offset + 64;
    // find the 0xff run end within this record
    let ffEnd = -1;
    for (let p = u.offset; p < end - 8; p++) {
      if (buf[p] === 0xff && buf[p+1]===0xff && buf[p+2]===0xff && buf[p+3]===0xff) {
        // advance to end of ff run
        let q = p; while (q < end && buf[q] === 0xff) q++;
        ffEnd = q; break;
      }
    }
    if (ffEnd < 0) { console.log(`  ${u.name}: no ff run`); continue; }
    const trailer = Array.from(buf.slice(ffEnd, Math.min(end, ffEnd + 32))).map(b => b.toString(16).padStart(2, '0')).join(' ');
    // does the general's commanderUuid appear in the trailer?
    const cu = Buffer.alloc(4); cu.writeUInt32LE(army.leader.commanderUuid >>> 0);
    const hasCmdr = buf.indexOf(cu, ffEnd) === ffEnd || (buf.slice(ffEnd, ffEnd + 64).indexOf(cu) >= 0);
    console.log(`  ${u.name.padEnd(22)} trailerLen=${end - ffEnd} cmdrInTrailer=${hasCmdr} trailer: ${trailer}`);
  }
}
