// Session 30: dump typeA/typeB enum for all 22 named scripted-events
// Region 0x846d1..0xa8beb in save_rome10.sav
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const START = 0x846d1, END = 0xa8beb;
const buf = fs.readFileSync(path).subarray(START, END);

// Scan for known event-name keywords as ASCII inside the region.
// Each named event has shape: [u16 len][ASCII category][nul][u16 len][ASCII event_name][nul][i32 year][u32 typeA][u32 typeB][u32 X][u32 Y][u32 triggers]
// We locate the event-name string by looking for the typical "eruption_at_", "earthquake_at_", "flood_in_" prefixes.
const prefixes = ['eruption_at_', 'earthquake_at_', 'earthquake_in_', 'flood_in_', 'flood_at_', 'tsunami_at_'];

function findAllAscii(buf, needle) {
  const out = [];
  const n = Buffer.from(needle, 'ascii');
  let i = 0;
  while (true) {
    const j = buf.indexOf(n, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

const hits = [];
for (const p of prefixes) {
  for (const off of findAllAscii(buf, p)) {
    // walk forward from `off` to find the terminating nul
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    const name = buf.subarray(off, end).toString('ascii');
    // after the nul: the next bytes should be i32 year, u32 typeA, u32 typeB, u32 X, u32 Y, u32 triggers
    const fieldsAt = end + 1;
    if (fieldsAt + 24 > buf.length) continue;
    const year   = buf.readInt32LE(fieldsAt + 0);
    const typeA  = buf.readUInt32LE(fieldsAt + 4);
    const typeB  = buf.readUInt32LE(fieldsAt + 8);
    const tileX  = buf.readUInt32LE(fieldsAt + 12);
    const tileY  = buf.readUInt32LE(fieldsAt + 16);
    const trig   = buf.readUInt32LE(fieldsAt + 20);
    hits.push({ name, year, typeA, typeB, tileX, tileY, trig, absOff: START + off });
  }
}

// Dedup by absOff
const seen = new Set();
const uniq = [];
for (const h of hits) {
  if (seen.has(h.absOff)) continue;
  seen.add(h.absOff);
  uniq.push(h);
}
uniq.sort((a, b) => a.absOff - b.absOff);

// Print
console.log(`Found ${uniq.length} named events`);
console.log('idx | offset    | typeA typeB | year  | (X,Y)       | trig | name');
console.log('-'.repeat(110));
let idx = 0;
for (const h of uniq) {
  const cat =
    h.name.startsWith('eruption_') ? 'VOLC' :
    h.name.startsWith('earthquake_') ? 'QUAKE' :
    h.name.startsWith('flood_') ? 'FLOOD' :
    h.name.startsWith('tsunami_') ? 'TSUN' : '?';
  console.log(
    `${String(idx++).padStart(2)} ${cat.padEnd(5)} 0x${h.absOff.toString(16).padStart(6, '0')} | ` +
    `${String(h.typeA).padStart(3)}  ${String(h.typeB).padStart(3)}   | ` +
    `${String(h.year).padStart(5)} | (${String(h.tileX).padStart(4)},${String(h.tileY).padStart(4)}) | ` +
    `${String(h.trig).padStart(3)} | ${h.name}`
  );
}

// Aggregate by category
console.log('\nBy category — typeA distribution:');
const cats = {};
for (const h of uniq) {
  const cat =
    h.name.startsWith('eruption_') ? 'VOLC' :
    h.name.startsWith('earthquake_') ? 'QUAKE' :
    h.name.startsWith('flood_') ? 'FLOOD' :
    h.name.startsWith('tsunami_') ? 'TSUN' : '?';
  cats[cat] ??= { typeA: {}, typeB: {} };
  cats[cat].typeA[h.typeA] = (cats[cat].typeA[h.typeA] || 0) + 1;
  cats[cat].typeB[h.typeB] = (cats[cat].typeB[h.typeB] || 0) + 1;
}
for (const [cat, dist] of Object.entries(cats)) {
  console.log(`  ${cat.padEnd(6)} typeA=${JSON.stringify(dist.typeA)}  typeB=${JSON.stringify(dist.typeB)}`);
}

// Cross-tab typeA vs typeB pairs
console.log('\n(typeA, typeB) pair distribution overall:');
const pairs = {};
for (const h of uniq) {
  const k = `(${h.typeA},${h.typeB})`;
  pairs[k] = (pairs[k] || 0) + 1;
}
console.log('  ' + JSON.stringify(pairs));
