// dig-gap10.js — analyze the 16KB tail region in the gap (0xf84641 .. 0xf88637)
// This region contains building strings — likely orphan settlement records or post-tile-array continuation.

const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const TAIL = 0xf84641;
const END = 0xf88637;

// Get ALL ASCII strings >=4 chars with positions
const strs = [];
let cur = null;
for (let p = TAIL; p < END; p++) {
  const b = buf[p];
  if (b >= 32 && b <= 126) {
    if (!cur) cur = { start: p, end: p };
    cur.end = p;
  } else {
    if (cur && cur.end - cur.start + 1 >= 4) strs.push(cur);
    cur = null;
  }
}
if (cur && cur.end - cur.start + 1 >= 4) strs.push(cur);

console.log(`${strs.length} ASCII strings >= 4 chars in tail 0x${TAIL.toString(16)}..0x${END.toString(16)} (${END - TAIL} bytes)`);
strs.forEach(s => {
  const text = buf.slice(s.start, s.end+1).toString('ascii');
  console.log(`  0x${s.start.toString(16)}  +${(s.start-TAIL).toString().padStart(5)}  len=${(s.end-s.start+1).toString().padStart(3)}  "${text}"`);
});

// Reading these in order: default_set, hinterland_region, core_building, government, military_industrial_complex, irrigated_farming, market, port_buildings, dyes_production, health, hinterland_roads, temples_of_viking, defenses, then loop again
// This is EXACTLY the pattern of one settlement's building chain list.
// So the tail contains 1+ settlement records (probably 1-3 of them).

// Count occurrences of "default_set" — that's typically the first entry per settlement
let countDefSet = 0;
for (let p = TAIL; p < END - 11; p++) {
  if (buf.slice(p, p+11).toString('ascii') === 'default_set') countDefSet++;
}
console.log(`\n"default_set" occurrences: ${countDefSet}`);

// Find offsets of each default_set
const dsPos = [];
for (let p = TAIL; p < END - 11; p++) {
  if (buf.slice(p, p+11).toString('ascii') === 'default_set') dsPos.push(p);
}
console.log(`default_set positions: ${dsPos.map(p => '0x'+p.toString(16)).join(', ')}`);

// So we have N settlement records in the tail. Print boundaries.
for (let i = 0; i < dsPos.length; i++) {
  const s = dsPos[i];
  const e = (i+1 < dsPos.length) ? dsPos[i+1] : END;
  console.log(`tail-settlement ${i+1}: 0x${s.toString(16)}..0x${e.toString(16)} (${e-s} bytes)`);
}

// What appears BEFORE the first default_set in tail?
console.log(`\n=== bytes 0xf84641..0xf8464e (${dsPos[0] - TAIL} bytes before first default_set) ===`);
const pre = buf.slice(TAIL, dsPos[0]);
console.log(Array.from(pre).map(b => b.toString(16).padStart(2,'0')).join(' '));
console.log(`(ascii): "${pre.toString('ascii').replace(/[^\x20-\x7e]/g,'.')}"`);

// CONCLUSION: tail is N settlement-building-state records (looks like 3 of them based on default_set count)
// These appear to be ORPHAN settlements that ended up in the tile-attr gap region — perhaps small/inactive ones
