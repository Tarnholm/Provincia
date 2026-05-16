// Session 110 — drill into the two interesting diff sites from dig-halo-move-1.js:
//   (a) 0x000043f8 (body+char_paths, 2-byte change — candidate for Gnaeus position)
//   (b) 0x0224e1d7..0x02252b16 (player exploration grid — halo redrew)
// Also: verify the 270-cluster NPC tail is dominated by self-pointer -2 shifts.

const fs = require('fs');

const A_PATH = 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav';
const B_PATH = 'C:\\Users\\vtarn\\Downloads\\save_halo_moved.sav..sav';
const A = fs.readFileSync(A_PATH);
const B = fs.readFileSync(B_PATH);

console.log('=== Site (a): 0x000043f8 ± 64 bytes ===\n');
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
dump('A:', A, 0x4380, 0x4480);
dump('B:', B, 0x4380, 0x4480);

// Interpret the 2 changed bytes
console.log('\nChanged bytes:');
console.log('  A[0x43f8..0x43fa] = ' + A.subarray(0x43f8, 0x43fa).toString('hex'));
console.log('  B[0x43f8..0x43fa] = ' + B.subarray(0x43f8, 0x43fa).toString('hex'));

// Try reading as u16 / i16 around the area
console.log('\nAs little-endian fields near 0x43f8:');
for (let o = 0x43f0; o <= 0x4400; o += 2) {
  const a16 = A.readUInt16LE(o);
  const b16 = B.readUInt16LE(o);
  if (a16 !== b16) {
    console.log('  u16@0x' + o.toString(16) + ': A=' + a16 + ' (0x' + a16.toString(16) + ')  B=' + b16 + ' (0x' + b16.toString(16) + ')  Δ=' + (b16-a16));
  }
}
for (let o = 0x43f0; o <= 0x4400; o += 4) {
  const a32 = A.readUInt32LE(o);
  const b32 = B.readUInt32LE(o);
  if (a32 !== b32) {
    console.log('  u32@0x' + o.toString(16) + ': A=' + a32 + ' (0x' + a32.toString(16) + ')  B=' + b32 + ' (0x' + b32.toString(16) + ')  Δ=' + (b32-a32));
  }
}
// And as floats
for (let o = 0x43f0; o <= 0x4400; o += 4) {
  const af = A.readFloatLE(o);
  const bf = B.readFloatLE(o);
  if (af !== bf && !(isNaN(af) && isNaN(bf))) {
    console.log('  f32@0x' + o.toString(16) + ': A=' + af.toFixed(4) + '  B=' + bf.toFixed(4) + '  Δ=' + (bf-af).toFixed(4));
  }
}

// Site (b): the big player-exploration cluster. Dump a small head to confirm it's RLE
// like the per-NPC grids from session 108/103.
console.log('\n\n=== Site (b): 0x0224e1d7 player exploration grid (?) — head ===\n');
dump('A:', A, 0x0224e1d7 - 32, 0x0224e1d7 + 64);
dump('B:', B, 0x0224e1d7 - 32, 0x0224e1d7 + 64);

// Where is this in the file structure? Look for the nearest preceding ff 0a af f0 magic
console.log('\nNearest preceding ff 0a af f0 magic to 0x0224e1d7:');
for (let o = 0x0224e1d7 - 0x80000; o < 0x0224e1d7; o++) {
  if (A[o] === 0xff && A[o+1] === 0x0a && A[o+2] === 0xaf && A[o+3] === 0xf0) {
    // Most recent
    const dist = 0x0224e1d7 - o;
    console.log('  candidate at 0x' + o.toString(16) + '  dist=' + dist + ' (' + (dist/1024).toFixed(1) + ' KB)');
  }
}

// Site (c): verify the 0x02087764-style strided clusters are self-pointer shifts.
// Read u32 at the cluster offset in A and B; expect A=offset, B=offset-2.
console.log('\n\n=== Site (c): are the "NPC tail" small clusters self-pointer shifts? ===\n');
const SHIFTED = [
  0x02087764, 0x0208987c, 0x0208b994, 0x0208e3d4, 0x02090d80,
  0x02094a15, 0x0209947a, 0x0209b734, 0x0209d593, 0x0209f5ec,
  0x020a1586, 0x020a389b, 0x020a563c, 0x020a76e2, 0x020a8f68,
];
let ptrShifts = 0, nonShifts = 0;
for (const off of SHIFTED) {
  const a32 = A.readUInt32LE(off);
  const b32 = B.readUInt32LE(off);
  const isShift = (b32 === a32 - 2) && (a32 === off);
  if (isShift) ptrShifts++; else nonShifts++;
  console.log('  0x' + off.toString(16) + ': A.u32=0x' + a32.toString(16) + ' B.u32=0x' + b32.toString(16) +
              ' (self=' + (a32===off) + ', shift-2=' + (b32===a32-2) + ', match=' + isShift + ')');
}
console.log('Self-pointer-shift confirmed: ' + ptrShifts + '/' + SHIFTED.length);

// Site (d): the second medium cluster at 0x02083b72..0x02083ddd.
// This is in the NPC tail but might be content (not just pointer shift) because it
// has 80+ bytes of scattered changes in a 600-byte window.
console.log('\n\n=== Site (d): 0x02083b72..0x02083ddd dense small-change zone ===\n');
dump('A:', A, 0x02083b40, 0x02083e00);
dump('B:', B, 0x02083b40, 0x02083e00);

// Site (e): settlement+factions changes
console.log('\n\n=== Site (e): settlement zone — 0x01510e14 ===\n');
dump('A:', A, 0x01510df0, 0x01510e80);
dump('B:', B, 0x01510df0, 0x01510e80);
console.log('\n0x01536422 (1-byte 00→01 flag flip):');
dump('A:', A, 0x01536400, 0x01536440);
dump('B:', B, 0x01536400, 0x01536440);
