// Check the embedded-string key in each default_set across MULTIPLE settlements.
// If keys are "equestrian" / "elephants" / "horses" etc., they're hidden resources.
// If keys are "greek" / "roman" / "barbarian" etc., they're cultures.
// If they're "macedon" / "greek_cities", they're factions.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVE = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Find every default_set marker in the entire file
const target = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
const allDs = [];
let p = 0;
while (true) {
  const idx = SAVE.indexOf(target, p);
  if (idx === -1) break;
  allDs.push(idx);
  p = idx + 14;
}
console.log('Total default_set markers in save: ' + allDs.length);

// For each marker, scan the 61-byte trailer for an embedded pstr16 ASCII string
// (e.g., "equestrian"). Lower-case ASCII strings of length 4+ are likely keys.
console.log('\nFor each default_set, find any embedded ASCII key:');
const keyCounts = {};
const keyExamples = {};
for (let i = 0; i < allDs.length; i++) {
  const off = allDs[i];
  const trailer = SAVE.slice(off + 14, off + 14 + 61);
  // Look for any pstr16 ASCII inside this trailer
  let key = null;
  for (let j = 0; j < trailer.length - 4; j++) {
    const r = readPstr16Asciiz(SAVE, off + 14 + j);
    if (!r) continue;
    if (r.str.length < 3) continue;
    if (!/^[a-z_][a-z_0-9]+$/.test(r.str)) continue;
    if (r.str === 'default_set') continue;
    key = r.str;
    break;
  }
  if (key) {
    keyCounts[key] = (keyCounts[key] || 0) + 1;
    if (!keyExamples[key]) keyExamples[key] = [];
    if (keyExamples[key].length < 3) keyExamples[key].push('0x' + off.toString(16));
  } else {
    keyCounts['<no-key>'] = (keyCounts['<no-key>'] || 0) + 1;
  }
}

console.log('\nKey distribution across all ' + allDs.length + ' default_set markers:');
const sortedKeys = Object.entries(keyCounts).sort((a, b) => b[1] - a[1]);
for (const [key, count] of sortedKeys) {
  const examples = keyExamples[key] ? ' (e.g. ' + keyExamples[key].slice(0, 2).join(', ') + ')' : '';
  console.log('  ' + key.padEnd(25) + ' x' + count + examples);
}

// Now check: do most settlements have EXACTLY 3 default_set markers, or does the
// count vary by what resources/conditions the settlement has?
// Estimate by looking at marker GAPS — markers within 5000 bytes likely belong
// to the same settlement.
console.log('\n=== Cluster default_set markers by proximity (<3000 bytes apart = same settlement) ===');
const clusters = [[allDs[0]]];
for (let i = 1; i < allDs.length; i++) {
  if (allDs[i] - allDs[i - 1] < 3000) {
    clusters[clusters.length - 1].push(allDs[i]);
  } else {
    clusters.push([allDs[i]]);
  }
}
const clusterSizes = {};
for (const c of clusters) {
  clusterSizes[c.length] = (clusterSizes[c.length] || 0) + 1;
}
console.log('Cluster size distribution:');
for (const [size, count] of Object.entries(clusterSizes).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  console.log('  ' + size + ' markers/cluster: ' + count + ' clusters');
}
console.log('Total clusters (settlements?): ' + clusters.length);
