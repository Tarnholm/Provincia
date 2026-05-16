// Session 110 — pin character position record at 0x01510e10.
// We saw:
//   +0x14: u32 X    287 → 288
//   +0x18: u32 Y    400 → 399
//   +0x1c: u32      98303 → 90112  (-8191 = packed sub-tile?)
//   +0x39: byte     0x0a → 0x00    (action-this-turn flag?)
//   +0x46: f32      248.0 → 232.21 (MP remaining)
// Goals:
//   (i)   dump record header — find self-pointer / size
//   (ii)  walk backward to find character name string ("Gnaeus", "Scipio")
//   (iii) walk forward to see record body — look for portrait, trait, ancillary fields

const fs = require('fs');

const A_PATH = 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav';
const B_PATH = 'C:\\Users\\vtarn\\Downloads\\save_halo_moved.sav..sav';
const A = fs.readFileSync(A_PATH);
const B = fs.readFileSync(B_PATH);

function hexLine(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  return hex + '  ' + ascii;
}
function dump(label, buf, start, end) {
  console.log(label);
  for (let o = start; o < end; o += 16) {
    console.log('  0x' + o.toString(16).padStart(8, '0') + ': ' + hexLine(buf, o, Math.min(16, end - o)));
  }
}

// (i): record context — 256 bytes back and 256 bytes forward from 0x01510e00
console.log('=== (i) 512 bytes around section header 0x01510e00 ===');
dump('A:', A, 0x01510d00, 0x01510f00);

// Verify self-pointers
console.log('\nSelf-pointer check at 0x01510e00:');
[0x01510e00, 0x01510e04, 0x01510e10].forEach(o => {
  console.log('  u32@0x' + o.toString(16) + ' = 0x' + A.readUInt32LE(o).toString(16) + ' (self=' + (A.readUInt32LE(o) === o) + ')');
});
console.log('  u32@0x01510e08 = ' + A.readUInt32LE(0x01510e08) + ' (probably section size)');

// What's at the offset pointed to BY u32@0x01510e10? Should be self-pointing.
const p10 = A.readUInt32LE(0x01510e10);
console.log('  Next section (if u32@+0x10 is a forward ptr): 0x' + p10.toString(16));

// (ii): find UTF-16 name string before 0x01510e00. Look back for length-prefixed UTF-16 strings.
console.log('\n=== (ii) Scan back 4 KB for UTF-16 strings (looking for character name) ===');
function tryUtf16Pstr(buf, o) {
  if (o + 2 > buf.length) return null;
  const lenChars = buf.readUInt16LE(o);
  if (lenChars < 2 || lenChars > 100) return null;
  if (o + 2 + lenChars * 2 > buf.length) return null;
  for (let j = 0; j < lenChars; j++) {
    const c = buf.readUInt16LE(o + 2 + j * 2);
    if (c < 0x20 || c > 0x7e) return null;
  }
  const s = [];
  for (let j = 0; j < lenChars; j++) s.push(String.fromCharCode(buf.readUInt16LE(o + 2 + j * 2)));
  return { off: o, str: s.join(''), totalLen: 2 + lenChars * 2 };
}
function tryAsciizPstr(buf, o) {
  if (o + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (o + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[o + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 2 + lenP1 - 1] !== 0) return null;
  return { off: o, str: buf.slice(o + 2, o + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

const SCAN_BACK = 0x4000;
const found16 = [], foundAsciiz = [];
for (let o = Math.max(0, 0x01510e00 - SCAN_BACK); o < 0x01510e00; o++) {
  const r = tryUtf16Pstr(A, o);
  if (r) found16.push(r);
  const r2 = tryAsciizPstr(A, o);
  if (r2) foundAsciiz.push(r2);
}
console.log('UTF-16 strings found (last 30):');
found16.slice(-30).forEach(s => console.log('  0x' + s.off.toString(16) + ' "' + s.str + '"'));
console.log('\nASCII strings found (last 30):');
foundAsciiz.slice(-30).forEach(s => console.log('  0x' + s.off.toString(16) + ' "' + s.str + '"'));

// (iii): scan forward 4 KB for ASCII fields (likely portrait, ancillaries, trait names)
console.log('\n=== (iii) ASCII strings 0..2 KB forward from 0x01510e10 ===');
const fwdAsciiz = [];
for (let o = 0x01510e10; o < 0x01510e10 + 0x800; o++) {
  const r = tryAsciizPstr(A, o);
  if (r) fwdAsciiz.push(r);
}
fwdAsciiz.forEach(s => console.log('  0x' + s.off.toString(16) + ' "' + s.str + '"'));

// (iv): direct comparison of the 64 bytes 0x01510e10..0x01510e50 as decoded fields
console.log('\n=== (iv) field-by-field decode of 0x01510e10..0x01510e50 ===');
const FIELDS = [
  { off: 0x01510e10, type: 'u32', name: 'self_ptr' },
  { off: 0x01510e14, type: 'u32', name: 'tile_X?' },
  { off: 0x01510e18, type: 'u32', name: 'tile_Y?' },
  { off: 0x01510e1c, type: 'u32', name: 'packed_sub?' },
  { off: 0x01510e20, type: 'u32', name: 'u32_or_pad' },
  { off: 0x01510e24, type: 'u32', name: 'u32_or_pad' },
  { off: 0x01510e28, type: 'u32', name: 'u32_or_pad' },
  { off: 0x01510e2c, type: 'i32', name: 'maybe_health_or_count' },
  { off: 0x01510e30, type: 'u32', name: 'u32_or_pad' },
  { off: 0x01510e34, type: 'u32', name: 'u32_or_pad' },
  { off: 0x01510e38, type: 'u32', name: 'maybe_flag_word' },
  { off: 0x01510e3c, type: 'u32', name: 'u32_or_pad' },
  { off: 0x01510e40, type: 'u32', name: 'u32_or_pad' },
  { off: 0x01510e44, type: 'u32', name: 'u32_or_pad' },
  { off: 0x01510e48, type: 'f32', name: 'mp_remaining?' },
  { off: 0x01510e4c, type: 'u32', name: 'u32_or_pad' },
];
for (const f of FIELDS) {
  let av, bv;
  if (f.type === 'u32') { av = A.readUInt32LE(f.off); bv = B.readUInt32LE(f.off); }
  else if (f.type === 'i32') { av = A.readInt32LE(f.off); bv = B.readInt32LE(f.off); }
  else if (f.type === 'f32') { av = A.readFloatLE(f.off); bv = B.readFloatLE(f.off); }
  const mark = av === bv ? '' : '  CHANGED';
  console.log('  +0x' + (f.off-0x01510e10).toString(16).padStart(2,'0') + ' (0x' + f.off.toString(16) + ') ' + f.name.padEnd(20) + ' ' + f.type + ' A=' + av + ' B=' + bv + mark);
}

// (v) also try i16+i16 packing on the 0x01510e1c "packed_sub" field
console.log('\nPacked interpretation of 0x01510e1c..0x01510e1f:');
console.log('  A: ' + A.subarray(0x01510e1c, 0x01510e20).toString('hex') +
            ' as u16+u16=' + A.readUInt16LE(0x01510e1c) + ',' + A.readUInt16LE(0x01510e1e));
console.log('  B: ' + B.subarray(0x01510e1c, 0x01510e20).toString('hex') +
            ' as u16+u16=' + B.readUInt16LE(0x01510e1c) + ',' + B.readUInt16LE(0x01510e1e));
console.log('  Delta low u16: ' + (B.readUInt16LE(0x01510e1c) - A.readUInt16LE(0x01510e1c)));

// (vi) walk back through preceding sections — find character record start
console.log('\n=== (vi) preceding section trail — find character record start ===');
let p = 0x01510e00;
let steps = 0;
const trail = [];
while (steps < 50) {
  // each section's previous one is at p - some-size; we don't know the size, so try
  // to find the section that POINTS to p (i.e., its size field would make selfPtr+size=p
  // by walking back through sections that self-point and have plausible size).
  // Simpler approach: just dump the 16 bytes before p — if it ends with a u32 self-pointer
  // at p-4, walk to that.
  if (p < 0x10) break;
  // We don't have a generic walk; just dump 32 bytes back and let me look.
  trail.push(p);
  // give up after 1 step; we already dumped 256 bytes above
  break;
}

// (vii) extra: dump 256 bytes around the 0x01536422 flag flip — was it 00→01? Check.
console.log('\n=== (vii) 256 bytes around 0x01536422 (flag flip) ===');
dump('A:', A, 0x01536400 - 0x100, 0x01536400 + 0x100);
console.log('\nB at 0x01536420..0x01536430:');
dump('B:', B, 0x01536420, 0x01536430);
