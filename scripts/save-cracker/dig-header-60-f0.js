// Dump and compare bytes 0x60-0xf0 of three RTW Rome Remastered saves.
const fs = require('fs');

const saves = [
  {
    label: 'RIS imperial (34.5MB)',
    path: 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_arretium pre retrained..sav',
  },
  {
    label: 'Vanilla? Spain T1 (1.3MB)',
    path: 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_17-05-2026   Spain   Turn 1.sav',
  },
  {
    label: 'Alexander Macedon T1 (1MB)',
    path: 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\save_17-05-2026   Macedon   Turn 1.sav',
  },
];

function hexRow(buf, off) {
  const slice = buf.slice(off, off + 16);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  return `0x${off.toString(16).padStart(4, '0')}  ${hex}  |${asc}|`;
}

function tryUtf16(buf, off, maxLen) {
  let s = '';
  for (let i = 0; i < maxLen; i += 2) {
    const c = buf.readUInt16LE(off + i);
    if (c === 0) break;
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s.length >= 2 ? s : null;
}

const dumps = [];
for (const sv of saves) {
  const buf = fs.readFileSync(sv.path);
  console.log('\n========================================================');
  console.log(`${sv.label}`);
  console.log(`  size: ${buf.length} bytes`);
  console.log(`  path: ${sv.path}`);
  console.log('========================================================');

  // First show the campaign name region so we know where 0x60 falls relative to it.
  const nameLen = buf.readUInt16LE(0x3a);
  const nameEnd = 0x3c + nameLen * 2;
  const name = buf.slice(0x3c, nameEnd).toString('utf16le');
  console.log(`  campaign name len ${nameLen} ends at 0x${nameEnd.toString(16)}  -> "${name}"`);

  // Dump 0x60..0xf0
  console.log('  bytes 0x60..0xf0:');
  for (let off = 0x60; off < 0xf0; off += 16) {
    console.log('    ' + hexRow(buf, off));
  }

  // Print every u32 in that range
  console.log('  u32 LE values 0x60..0xf0:');
  for (let off = 0x60; off < 0xf0; off += 4) {
    const v = buf.readUInt32LE(off);
    console.log(`    0x${off.toString(16).padStart(2,'0')}: 0x${v.toString(16).padStart(8,'0')}  (${v})`);
  }

  // Scan for embedded UTF-16 strings
  console.log('  embedded UTF-16 LE candidates in 0x60..0x200:');
  for (let off = 0x60; off < 0x200; off += 2) {
    const s = tryUtf16(buf, off, 200);
    if (s && s.length >= 3) {
      console.log(`    0x${off.toString(16)}: "${s}" (${s.length} chars, ends at 0x${(off + s.length*2 + 2).toString(16)})`);
    }
  }

  // Scan for UTF-8 / ASCII strings in same range
  console.log('  ASCII runs (>=4 chars) in 0x60..0x200:');
  let run = '';
  let runStart = -1;
  for (let off = 0x60; off < 0x200; off++) {
    const b = buf[off];
    if (b >= 0x20 && b < 0x7f) {
      if (runStart < 0) runStart = off;
      run += String.fromCharCode(b);
    } else {
      if (run.length >= 4) console.log(`    0x${runStart.toString(16)}: "${run}"`);
      run = '';
      runStart = -1;
    }
  }
  if (run.length >= 4) console.log(`    0x${runStart.toString(16)}: "${run}"`);

  // Verify 0xf0 marker
  const m = buf.readUInt32LE(0xf0);
  console.log(`  0xf0 u32 = 0x${m.toString(16).padStart(8,'0')} (expect 0x0ade3412)`);

  dumps.push({ label: sv.label, buf });
}

// Cross-save comparison: which bytes in 0x60..0xf0 are identical across all three?
console.log('\n========================================================');
console.log('CROSS-SAVE u32 COMPARISON 0x60..0xf0');
console.log('========================================================');
console.log('offset   | RIS imperial | Spain T1     | Macedon T1   | const?');
console.log('---------+--------------+--------------+--------------+-------');
for (let off = 0x60; off < 0xf0; off += 4) {
  const vs = dumps.map(d => d.buf.readUInt32LE(off));
  const constant = vs.every(v => v === vs[0]);
  const sameRomes = vs[0] === vs[1];
  const tag = constant ? 'ALL' : (sameRomes ? 'rome' : '-');
  console.log(
    `0x${off.toString(16).padStart(2,'0')}     | ` +
    vs.map(v => '0x' + v.toString(16).padStart(8,'0')).join(' | ') +
    ` | ${tag}`
  );
}

// Same for u16
console.log('\nCROSS-SAVE u16 COMPARISON 0x60..0xf0');
console.log('offset   | RIS    | Spain  | Macedon | const?');
for (let off = 0x60; off < 0xf0; off += 2) {
  const vs = dumps.map(d => d.buf.readUInt16LE(off));
  const constant = vs.every(v => v === vs[0]);
  if (constant) {
    console.log(`0x${off.toString(16).padStart(2,'0')}     | 0x${vs[0].toString(16).padStart(4,'0')} (CONST)`);
  }
}

// Single-byte differences map
console.log('\nBYTE-LEVEL DIFF MAP (X = differs across saves, . = same):');
let mapLine = '';
for (let off = 0x60; off < 0xf0; off++) {
  const allSame = dumps.every(d => d.buf[off] === dumps[0].buf[off]);
  mapLine += allSame ? '.' : 'X';
  if ((off - 0x5f) % 16 === 0) mapLine += '\n';
}
console.log(mapLine);

// Look for likely floats
console.log('\nFLOAT32 LE VALUES 0x60..0xf0:');
for (let off = 0x60; off < 0xf0; off += 4) {
  const vs = dumps.map(d => d.buf.readFloatLE(off));
  const plausible = vs.every(v => Number.isFinite(v) && Math.abs(v) > 1e-6 && Math.abs(v) < 1e8);
  if (plausible) {
    console.log(`  0x${off.toString(16)}: ${vs.map(v => v.toFixed(4)).join(' | ')}`);
  }
}
