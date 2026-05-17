// Decode the full 488-byte settlement stats block. Population is at +48.
// Hunt for: public order, happiness, religion %, squalor, garrison strength.
// Cross-validate across multiple settlements with known starting values.

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
  // Find IMMEDIATELY preceding 0x15 tag (with tighter bounds — don't skip the right one)
  let tagOff = -1;
  // Robust detection: look for `15 00 00 00` within ~600 bytes before name
  for (let p = nameOff - 4; p > Math.max(0, nameOff - 700); p--) {
    if (buf[p] === 0x15 && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) {
      // Verify it's the START of stats block: must be followed by reasonable data
      // (not in the middle of building data which has 0x15 terminators)
      // Check: if we go back further, do we hit another candidate?
      // The CORRECT one is the FIRST 0x15 we find walking BACKWARDS that's NOT
      // inside a 0xff..0xff terminator block.
      // Simple test: byte at p+4 should be != 0xff (avoid building trailers)
      if (buf[p+4] !== 0xff) {
        tagOff = p;
        break;
      }
    }
  }
  if (tagOff === -1) continue;
  settlements.push({
    name: readPstr16Utf16Extended(buf, nameOff).str,
    defSet: ds,
    nameOff,
    tagOff,
    blockStart: tagOff + 4,
    blockSize: nameOff - (tagOff + 4),
  });
}

console.log('Parsed ' + settlements.length + ' settlements with stats blocks');

// Find consistent fields: for each byte offset in the stats block, count
// how many settlements have plausible values
// Show every u32 across the first 10 settlements
console.log('\n=== Stats block u32 fields across 8 representative settlements ===');
const REPS = settlements.slice(0, 8);
console.log('  offset  ' + REPS.map(s => s.name.substring(0, 9).padStart(9)).join(' '));
for (let off = 0; off < 200; off += 4) {
  const row = REPS.map(s => {
    if (s.blockStart + off + 4 > buf.length) return 'NA';
    const v = buf.readUInt32LE(s.blockStart + off);
    if (v > 100000) return '0x' + v.toString(16).slice(-7);
    return String(v);
  });
  console.log('  +' + String(off).padStart(3) + ': ' + row.map(r => r.padStart(9)).join(' '));
}

// Find offsets where ALL settlements have plausible values (small ints, not garbage)
console.log('\n=== Offsets where most settlements have values in 0..10000 ===');
for (let off = 0; off < 488; off += 4) {
  const vals = settlements.map(s => {
    if (s.blockStart + off + 4 > buf.length) return null;
    return buf.readUInt32LE(s.blockStart + off);
  }).filter(v => v !== null);
  const plausible = vals.filter(v => v > 0 && v < 10000).length;
  if (plausible >= settlements.length * 0.5) {  // 50%+ have plausible values
    const ratio = plausible / vals.length;
    const sample = vals.slice(0, 8);
    console.log('  +' + String(off).padStart(3) + ' (' + (ratio * 100).toFixed(0) + '% plausible): samples=[' + sample.join(', ') + ']');
  }
}

// Find float fields
console.log('\n=== Float32 fields with consistent magnitudes ===');
for (let off = 0; off < 488; off += 4) {
  const vals = settlements.map(s => {
    if (s.blockStart + off + 4 > buf.length) return null;
    return buf.readFloatLE(s.blockStart + off);
  }).filter(v => v !== null && isFinite(v));
  const inRange = vals.filter(v => Math.abs(v) > 0.01 && Math.abs(v) < 10000).length;
  if (inRange >= settlements.length * 0.3) {
    const ratio = inRange / vals.length;
    const sample = vals.slice(0, 6).map(v => v.toFixed(1));
    console.log('  +' + String(off).padStart(3) + ' (' + (ratio * 100).toFixed(0) + '%): samples=[' + sample.join(', ') + ']');
  }
}
