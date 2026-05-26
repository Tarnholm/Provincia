// Full header + mod path decode across multiple saves.
// Goal: identify EVERY u32/u16/string in the header region 0..0x600.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const saves = [
  { name: 'PRE-retrain', path: path.join(BASE_R, 'save_arretium pre retrained..sav') },
  { name: 'POST-retrain', path: path.join(BASE_R, 'save_arretium retrained turn 2.sav') },
  { name: 'T2-queue',    path: path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav') },
  { name: 'T3',          path: path.join(BASE_R, 'save_arretium turn 3.sav') },
  { name: 'T4',          path: path.join(BASE_R, 'save_arretium turn 4.sav') },
  { name: 'Spain-T1',    path: path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav') },
  { name: 'Spain-T4',    path: path.join(BASE_R, 'save_Autosave   Spain   Turn 4.sav') },
  { name: 'Alex-Maced-T1', path: path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav') },
  { name: 'Alex-T11',    path: path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav') },
];

const bufs = saves.map(s => ({ name: s.name, buf: fs.readFileSync(s.path) }));

// Read each header position in EVERY save and report values
console.log('=== Header byte-by-byte across saves ===');
console.log('Format: offset (u8/u16/u32 LE values) — pattern across saves');
console.log();

function dumpField(offset, type) {
  const vals = bufs.map(b => {
    if (offset + 4 > b.buf.length) return 'N/A';
    if (type === 'u8') return b.buf[offset];
    if (type === 'u16') return b.buf.readUInt16LE(offset);
    if (type === 'u32') return b.buf.readUInt32LE(offset);
  });
  return vals;
}

// Step 1: dump u32 at every 4-byte offset from 0 to 0x400, find varying patterns
console.log('=== u32 values at 4-byte aligned offsets 0..0x300 ===');
for (let off = 0; off < 0x300; off += 4) {
  const vals = bufs.map(b => off + 4 <= b.buf.length ? b.buf.readUInt32LE(off) : 0);
  const unique = new Set(vals);
  const allHex = vals.map(v => '0x' + v.toString(16).padStart(8, '0')).join(' | ');
  // Highlight if values vary
  const tag = unique.size > 1 ? ' *VAR*' : '';
  // Show meaningful patterns
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  if (max < 100000000 && min !== 0) {  // Looks like a small u32
    console.log('  0x' + off.toString(16).padStart(4, '0') + ': ' + allHex + tag);
  } else if (unique.size > 1) {
    console.log('  0x' + off.toString(16).padStart(4, '0') + ': ' + allHex + tag);
  }
}

// Step 2: look at UTF-16/ASCII strings in header
console.log('\n=== Strings in header (0..0x600) ===');
function isPrintableAscii(b) { return b >= 0x20 && b <= 0x7e; }
function findStrings(buf, start, end) {
  const out = [];
  // ASCIIZ strings
  for (let p = start; p < Math.min(end, buf.length - 4); p++) {
    if (!isPrintableAscii(buf[p])) continue;
    let len = 0;
    while (p + len < end && isPrintableAscii(buf[p + len])) len++;
    if (len < 4) { p += len; continue; }
    if (buf[p + len] !== 0) { p += len; continue; }
    const s = buf.slice(p, p + len).toString('latin1');
    out.push({ off: p, str: s, type: 'asciiZ', len });
    p += len;
  }
  // UTF-16 LE strings
  for (let p = start; p < Math.min(end, buf.length - 8); p++) {
    if (!isPrintableAscii(buf[p]) || buf[p + 1] !== 0) continue;
    let len = 0;
    while (p + len * 2 + 1 < end && isPrintableAscii(buf[p + len * 2]) && buf[p + len * 2 + 1] === 0) len++;
    if (len < 4) { p += 1; continue; }
    const s = Array.from({length: len}, (_, i) => String.fromCharCode(buf[p + i * 2])).join('');
    out.push({ off: p, str: s, type: 'utf16LE', len });
    p += len * 2;
  }
  return out;
}

for (const b of bufs.slice(0, 3)) {  // Just first 3 saves
  console.log('\n--- ' + b.name + ' strings 0..0x600 ---');
  const strs = findStrings(b.buf, 0, 0x600);
  for (const s of strs) {
    console.log('  0x' + s.off.toString(16) + '  ' + s.type + ' "' + s.str + '"');
  }
}
