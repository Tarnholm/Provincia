// Test: does each faction get the same factionTag across saves of the
// same campaign? If yes, the factionTag is a STABLE per-faction identity
// (not a per-save random UUID), which would mean we could hardcode a
// factionTag→name table once and reuse it across all RIS imperial saves.

const fs = require('fs');
const path = require('path');

const FIX = 'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\';
const SAVES = [
  ['halo_oneman', 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav'],
  ['halo_moved',  'C:\\Users\\vtarn\\Downloads\\save_halo_moved.sav..sav'],
];
for (const f of fs.readdirSync(FIX)) {
  if (f.endsWith('.sav')) SAVES.push([f.replace(/\.sav$/, ''), path.join(FIX, f)]);
}

function findMajors(buf) {
  const records = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    records.push({ pos: i, treasury: buf.readInt32LE(i), regionCount: regions, factionTag: buf.readUInt32LE(i + 28) });
    i = Math.min(buf.length - 64, i + 92 + 4 * regions);
  }
  return records;
}

console.log('save'.padEnd(22) + '  majors  factionTag[0]    factionTag[1]    factionTag[3]    factionTag[22]');
const allTags = {};
for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const majors = findMajors(buf);
  console.log(tag.padEnd(22) + '  ' + String(majors.length).padStart(6) + '  ' +
              (majors[0] ? '0x' + majors[0].factionTag.toString(16).padStart(8, '0') : '-').padEnd(16) +
              (majors[1] ? '0x' + majors[1].factionTag.toString(16).padStart(8, '0') : '-').padEnd(16) +
              (majors[3] ? '0x' + majors[3].factionTag.toString(16).padStart(8, '0') : '-').padEnd(16) +
              (majors[22] ? '0x' + majors[22].factionTag.toString(16).padStart(8, '0') : '-'));
  for (let k = 0; k < majors.length; k++) {
    if (!allTags[k]) allTags[k] = new Map();
    const list = allTags[k];
    const t = majors[k].factionTag;
    list.set(tag, t);
  }
}

console.log('\n=== Per-major factionTag across all saves ===');
for (let k = 0; k < 23; k++) {
  const m = allTags[k];
  if (!m) continue;
  const distinctVals = new Set(m.values());
  console.log('  major[' + k + ']:  distinct factionTag values: ' + distinctVals.size + '  ' + Array.from(distinctVals).map(v => '0x' + v.toString(16).padStart(8, '0')).join(', '));
}

console.log('\n=== Saves grouped by major[0] factionTag (same campaign cluster) ===');
const groupBy0 = new Map();
for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const majors = findMajors(buf);
  if (majors.length === 0) continue;
  const t0 = majors[0].factionTag;
  if (!groupBy0.has(t0)) groupBy0.set(t0, []);
  groupBy0.get(t0).push(tag);
}
for (const [t0, list] of groupBy0) {
  console.log('  factionTag[0]=0x' + t0.toString(16).padStart(8, '0') + ' :  ' + list.join(', '));
}
