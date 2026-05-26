// dig-unit-final-validate.js
// Final consolidated validation of the UNIT container + ARMY grouping model.
//
// A) Container fields: te+4 f32 MP, te+8 u32 maxSoldiers, te+12 u32 curSoldiers.
//    - Find damaged units (cur<max) to prove +12 is casualties-aware current.
//    - Show MP float distribution (replenishes at turn start).
// B) Army grouping: segment by general/region; show that captain-led stacks
//    (no general) also form contiguous same-region runs >1.
// C) Cross-save stability of the unit UUID and the grouping.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

function regionTermEnd(buf, r) {
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
function load(file) {
  const buf = fs.readFileSync(path.join(BASE_R, file));
  const recs = findUnitRecords(buf).sort((a, b) => a.offset - b.offset);
  for (const r of recs) {
    const ne = r.offset + 2 + Buffer.from(r.name, 'ascii').length + 1;
    r.uuid = buf.readUInt32LE(ne);
    const te = regionTermEnd(buf, r);
    r.te = te;
    if (te != null && buf.readUInt32LE(te) === 0) {
      r.cMax = buf.readUInt32LE(te + 8);
      r.cCur = buf.readUInt32LE(te + 12);
      r.cMP = buf.readFloatLE(te + 4);
    }
  }
  return { buf, recs };
}

const A = load('save_arretium pre retrained..sav');

// A) damaged units
const damaged = A.recs.filter(r => r.cMax != null && r.cCur != null && r.cCur < r.cMax && r.cMax > 0 && r.cMax <= 240);
console.log(`Units with cur<max (casualties): ${damaged.length}`);
for (const r of damaged.slice(0, 12)) console.log(`   "${r.name}"@${r.region}: ${r.cCur}/${r.cMax}  MP=${r.cMP.toFixed(1)}`);

// MP float distribution for combat (non-general) units
const mps = A.recs.filter(r => r.cMP != null && !/general|bodyguard|captain/.test(r.name) && r.cMP > 0).map(r => r.cMP);
const mpset = {};
for (const v of mps) { const k = v.toFixed(1); mpset[k] = (mpset[k] || 0) + 1; }
console.log('\nMP float values for combat units (top 10):');
for (const [k, c] of Object.entries(mpset).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`   ${k}: ${c} units`);

// B) army segmentation including captain-led (no-general) multi-unit stacks
function isLeader(r) { return r.commanderUuid != null && /general|bodyguard|captain/.test(r.name); }
const armies = [];
let cur = null;
for (const r of A.recs) {
  const newArmy = !cur || isLeader(r) || r.region !== cur.region;
  if (newArmy) { cur = { region: r.region, leader: isLeader(r) ? r : null, units: [] }; armies.push(cur); }
  cur.units.push(r);
}
const captainStacks = armies.filter(a => !a.leader && a.units.length >= 2);
console.log(`\nCaptain-led / garrison multi-unit stacks (no general, >=2 units): ${captainStacks.length}`);
for (const a of captainStacks.slice(0, 8)) console.log(`   [${a.region}] ${a.units.length}: ${a.units.map(u => u.name.replace('roman ', '')).slice(0, 8).join(', ')}`);

// C) cross-save grouping stability: same army (by general uuid) keeps members?
const B = load('save_arretium turn 4.sav');
function armyByGeneral(L) {
  const recs = L.recs;
  const map = new Map(); // generalCmdrUuid -> [unit uuids]
  let curGen = null;
  for (const r of recs) {
    if (isLeader(r)) { curGen = r.commanderUuid; if (!map.has(curGen)) map.set(curGen, []); map.get(curGen).push(r.uuid); }
    else if (curGen != null && r.region === recs[recs.indexOf(r) - 1].region) {
      map.get(curGen).push(r.uuid);
    } else curGen = null;
  }
  return map;
}
const ga = armyByGeneral(A), gb = armyByGeneral(B);
// Compare the Etruria army (general cmdr 2123899338) membership PRE vs T4
const etruriaGen = 2123899338;
console.log(`\nEtruria army (gen ${etruriaGen}) membership PRE vs T4:`);
console.log('  PRE members (uuids):', (ga.get(etruriaGen) || []).length, '| T4:', (gb.get(etruriaGen) || []).length);
const setA = new Set(ga.get(etruriaGen) || []);
const setB = new Set(gb.get(etruriaGen) || []);
let common = 0; for (const u of setA) if (setB.has(u)) common++;
console.log(`  common unit UUIDs PRE∩T4: ${common} (PRE size ${setA.size}, T4 size ${setB.size})`);
