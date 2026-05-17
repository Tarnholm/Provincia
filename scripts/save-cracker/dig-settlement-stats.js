// The bytes BEFORE each settlement's UTF-16 name pstr16 contain a stats block
// with population, public order, happiness, etc. Let's decode it.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16Extended(buf, off) {
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
    const r = readPstr16Utf16Extended(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  settlements.push({
    name: readPstr16Utf16Extended(buf, nameOff).str,
    defSet: ds,
    nameOff,
  });
}

console.log('Parsed ' + settlements.length + ' settlements');

// Compute the START of each settlement record (= END of previous one)
for (let i = 0; i < settlements.length; i++) {
  settlements[i].statsStart = i === 0 ? 0x3c000 : settlements[i-1].defSet;  // crude
}

// Actually use a marker: the section before each name has the 0x15 section tag
// Look back from nameOff for `15 00 00 00`
for (const s of settlements) {
  let p = s.nameOff - 4;
  while (p > 0) {
    if (buf.readUInt32LE(p) === 0x15) {
      s.tagOff = p;
      break;
    }
    p -= 4;
  }
}

// Print stats block for a few well-known settlements
const TARGETS = ['Rome', 'Memphis', 'Carthage', 'Athens', 'Carthago_Nova', 'Asturica', 'Numantia', 'Arretium'];
for (const name of TARGETS) {
  const s = settlements.find(x => x.name === name);
  if (!s) { console.log('\n' + name + ': not found'); continue; }
  console.log('\n=== ' + name + ' stats (nameOff=0x' + s.nameOff.toString(16) + ', tagOff=0x' + (s.tagOff ? s.tagOff.toString(16) : '?') + ') ===');
  if (!s.tagOff) continue;
  const blockStart = s.tagOff + 4;
  console.log('  Stats block: 0x' + blockStart.toString(16) + ' to 0x' + s.nameOff.toString(16) + ' (' + (s.nameOff - blockStart) + ' bytes)');
  // The stats block is short — print it
  const blockLen = s.nameOff - blockStart;
  for (let off = blockStart; off < s.nameOff && off + 4 <= buf.length; off += 4) {
    const u = buf.readUInt32LE(off);
    const f = buf.readFloatLE(off);
    let interp = '';
    if (u < 100000 && u > 0) interp += ' u=' + u;
    if (Math.abs(f) >= 0.001 && Math.abs(f) < 100000 && !isNaN(f)) interp += ' f=' + f.toFixed(1);
    console.log('    +' + (off - blockStart) + ': 0x' + u.toString(16).padStart(8, '0') + interp);
  }
}
