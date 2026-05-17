// Hunt for settlement population values within each settlement's record.
// Known vanilla 270 BC populations:
//   Rome: ~25000 (large_city)
//   Memphis: ~24000 (huge_city)
//   Carthage: ~18000 (large_city)
//   Capua: ~8000 (large_town)
//   Athens: ~12000 (city)
//   Arretium: ~3500 (small_town)
//   Carthago_Nova: ~2500-4000 (town)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const t1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const defSets = findPstr16Asciiz(t1, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -20; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(t1, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  // Find the end of the settlement record (= start of next settlement, or end)
  settlements.push({
    name: nameOff !== -1 ? readPstr16Utf16(t1, nameOff).str : '???',
    defSet: ds
  });
}

// Find next-settlement start so we can compute record bounds
for (let i = 0; i < settlements.length; i++) {
  settlements[i].endOff = i + 1 < settlements.length ? settlements[i+1].defSet : 0x90000;
}

// For each major settlement, scan its record for u32 values in 1000-30000
const TARGETS = ['Rome', 'Memphis', 'Carthage', 'Capua', 'Athens', 'Arretium', 'Carthago_Nova', 'Corduba'];
for (const target of TARGETS) {
  const s = settlements.find(x => x.name === target);
  if (!s) continue;
  console.log('\n=== ' + target + ' (record: 0x' + s.defSet.toString(16) + ' to 0x' + s.endOff.toString(16) + ', ' + (s.endOff - s.defSet) + ' bytes) ===');
  const candidates = [];
  for (let off = s.defSet; off + 4 <= s.endOff; off += 4) {
    const v = t1.readUInt32LE(off);
    if (v < 1000 || v > 30000) continue;
    if (v % 256 === 0) continue;  // skip fixed-point
    const relOff = off - s.defSet;
    candidates.push({ off, relOff, v });
  }
  // Show first 20
  for (const c of candidates.slice(0, 20)) {
    console.log('  u32@0x' + c.off.toString(16) + ' (+' + c.relOff + '): ' + c.v);
  }
}

// Compare same relative offset across settlements — if there's a consistent
// per-record-offset that's the population field, we'll see it
console.log('\n=== Same-relative-offset candidates across settlements ===');
const offsetVals = {};
for (const s of settlements) {
  if (!s.name || s.name === '???') continue;
  for (let off = s.defSet; off + 4 <= s.endOff; off += 4) {
    const v = t1.readUInt32LE(off);
    if (v < 1000 || v > 30000) continue;
    if (v % 256 === 0) continue;
    const relOff = off - s.defSet;
    if (!offsetVals[relOff]) offsetVals[relOff] = [];
    offsetVals[relOff].push({ name: s.name, v });
  }
}
// Show offsets that appear in MOST settlements (consistent field)
const sortedOffsets = Object.entries(offsetVals).sort((a, b) => b[1].length - a[1].length);
console.log('Top 10 most-consistent offsets:');
for (const [off, vals] of sortedOffsets.slice(0, 10)) {
  console.log('  rel-offset +' + off + ' appears in ' + vals.length + ' settlements. Samples: ' +
    vals.slice(0, 6).map(v => v.name + '=' + v.v).join(', '));
}
