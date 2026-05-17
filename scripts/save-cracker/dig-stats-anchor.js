// Find a RELIABLE anchor for each settlement's stats block.
// Approach: the stats block sits between consecutive default_set buildings.
// Walk forward from one settlement's default_set+buildings, find the END of
// the buildings list (recognizable trailer pattern), and the next byte is
// the START of the next settlement's stats block.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

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

const defSets = findPstr16Asciiz(buf, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  settlements.push({
    name: readPstr16Utf16(buf, nameOff).str,
    defSet: ds,
    nameOff,
  });
}

// Walk forward from each default_set to find where this settlement's buildings list ends.
// Building format: pstr16(name) + 78 bytes data
// End of buildings list: when we hit a series of 0xff bytes followed by ?
// The TRAILER pattern observed: `15 00 00 00 ff ff ff ff ... ff ff XX XX 01 00 09`

// For each settlement, compute its record extent: from nameOff back to where
// previous settlement's trailer ended.

// Actually let's just compute the gap between names and treat that as the
// "TOTAL SETTLEMENT SIZE" = stats_block + name_pstr16 + buildings + trailer
console.log('=== Per-settlement total size (gap from this name to next name) ===');
for (let i = 0; i < Math.min(10, settlements.length - 1); i++) {
  const cur = settlements[i];
  const next = settlements[i + 1];
  const gap = next.nameOff - cur.nameOff;
  const nameLen = 2 + cur.name.length * 2;  // pstr16 of name
  // The "gap" = nameLen + 18 + default_set(14) + header(61?) + buildings + trailer + nextStatsBlock
  // For first settlement (Arretium), trailer + nextStatsBlock should be locatable
  console.log('  ' + cur.name.padEnd(20) + ' size=' + gap + ' (nameLen=' + nameLen + ')');
}

// For Arretium specifically, walk the building list and find the END
console.log('\n=== Detailed walk: Arretium\'s building list ===');
const arret = settlements.find(s => s.name === 'Arretium');
const headerEnd = arret.defSet + 14 + 92;  // after the 92-byte default_set header
let p = headerEnd;
console.log('  Header ends at 0x' + p.toString(16) + ', buildings start');
let buildingCount = 0;
while (buildingCount < 30) {
  const r = readPstr16Asciiz(buf, p);
  if (!r || !/^[a-z_]/.test(r.str) || r.str.length < 4) {
    console.log('  No more buildings at 0x' + p.toString(16) + '. Last byte: 0x' + buf[p].toString(16));
    break;
  }
  console.log('  building ' + buildingCount + ': "' + r.str + '" at 0x' + p.toString(16));
  p += r.totalLen + 78;
  buildingCount++;
}
console.log('  After ' + buildingCount + ' buildings, position at 0x' + p.toString(16));

// Now look at what comes AFTER (should be trailer + next stats block)
function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
console.log('  Bytes after buildings (0x' + p.toString(16) + '):');
for (let row = 0; row < 6; row++) {
  console.log('    0x' + (p + row * 32).toString(16) + ': ' + hex(p + row * 32, 32));
}

// Next settlement is Ariminum at 0x1a12b
const arim = settlements.find(s => s.name === 'Ariminum');
console.log('\n  Next settlement Ariminum name at 0x' + arim.nameOff.toString(16));
console.log('  Distance from Arretium buildings end to Ariminum name: ' + (arim.nameOff - p) + ' bytes');
// That distance = trailer (Arretium's record end) + Ariminum's stats block + Ariminum's name pstr16
// The Ariminum name pstr16 is 18 bytes (2 + 16). So trailer + stats = distance - 18.
const trailerStatsLen = arim.nameOff - p - 18;
console.log('  Trailer + next stats block = ' + trailerStatsLen + ' bytes');

// Show what's in this region
console.log('\n  Detail of trailer+stats zone:');
for (let row = 0; row < Math.ceil(trailerStatsLen / 32); row++) {
  if (row > 20) break;
  console.log('    0x' + (p + row * 32).toString(16) + ': ' + hex(p + row * 32, 32));
}
