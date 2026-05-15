// Session 58: 113 KB unclaimed range 0x14e5ac6..0x1501615
// "settlement-zone -> unit-zone seam"
// Goals: dump head/tail, histogram bytes, find ASCII strings, look for stride.
const fs = require('fs');
const path = require('path');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const START = 0x14e5ac6;
const END   = 0x1501615;
const LEN = END - START;

const buf = fs.readFileSync(SAVE);
const slice = buf.subarray(START, END);
console.log(`range start=0x${START.toString(16)} end=0x${END.toString(16)} len=${LEN} (0x${LEN.toString(16)})`);

function hex(buf, off, n) {
  const lines = [];
  for (let i = 0; i < n; i += 16) {
    const row = buf.subarray(off + i, off + i + 16);
    const hx = [...row].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const as = [...row].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    lines.push(`${(off+i).toString(16).padStart(8,'0')}  ${hx.padEnd(48)}  ${as}`);
  }
  return lines.join('\n');
}

console.log('\n--- HEAD 512 B ---');
console.log(hex(buf, START, 512));
console.log('\n--- TAIL 512 B ---');
console.log(hex(buf, END - 512, 512));

// Histogram
const hist = new Uint32Array(256);
for (let i = 0; i < slice.length; i++) hist[slice[i]]++;
const top = [...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
console.log('\n--- TOP 12 BYTES ---');
top.forEach(([b,c]) => console.log(`0x${b.toString(16).padStart(2,'0')}: ${c} (${(100*c/LEN).toFixed(2)}%)`));
const zeros = hist[0];
console.log(`zeros: ${zeros} (${(100*zeros/LEN).toFixed(2)}%)`);

// ASCII strings (runs of 6+ printable bytes)
console.log('\n--- ASCII RUNS (>=6) ---');
let run = '';
let runStart = -1;
const strings = [];
for (let i = 0; i < slice.length; i++) {
  const b = slice[i];
  if (b >= 0x20 && b < 0x7f) {
    if (run.length === 0) runStart = i;
    run += String.fromCharCode(b);
  } else {
    if (run.length >= 6) strings.push([runStart + START, run]);
    run = '';
  }
}
if (run.length >= 6) strings.push([runStart + START, run]);
console.log(`total runs: ${strings.length}`);
strings.slice(0, 80).forEach(([off, s]) => console.log(`  0x${off.toString(16)}  ${s.slice(0,80)}`));
if (strings.length > 80) console.log(`  ... +${strings.length-80} more`);

// taw self-pointer pattern: u32 offset==pos, u32 size, where pointer points to its own absolute offset
console.log('\n--- TAW SELF-POINTER scan ---');
let tawHits = 0;
const tawSamples = [];
for (let i = 0; i + 8 <= slice.length; i += 4) {
  const off = slice.readUInt32LE(i);
  if (off === (START + i)) {
    tawHits++;
    if (tawSamples.length < 20) {
      const sz = slice.readUInt32LE(i+4);
      tawSamples.push([START+i, off, sz]);
    }
  }
}
console.log(`taw self-pointer hits: ${tawHits}`);
tawSamples.forEach(([pos, off, sz]) => console.log(`  pos=0x${pos.toString(16)} off=0x${off.toString(16)} size=${sz} (0x${sz.toString(16)})`));

// Stride detection: find repeating signatures (look at 32-bit values at regular intervals)
// Try common record sizes
console.log('\n--- STRIDE candidates (look for repeating first u32 patterns) ---');
const strides = [4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80, 96, 128, 256];
for (const st of strides) {
  // count how many adjacent windows share the same first byte
  let matches = 0;
  let n = Math.floor(LEN / st);
  if (n < 4) continue;
  const firstBytes = new Map();
  for (let k = 0; k < n; k++) {
    const v = slice.readUInt8(k * st);
    firstBytes.set(v, (firstBytes.get(v) || 0) + 1);
  }
  const top = [...firstBytes.entries()].sort((a,b)=>b[1]-a[1])[0];
  const pct = 100 * top[1] / n;
  if (pct > 25) console.log(`  stride=${st}  n=${n}  top first-byte=0x${top[0].toString(16)} hits=${top[1]} (${pct.toFixed(1)}%)`);
}

// First 256 u32s for eyeballing
console.log('\n--- first 64 u32s ---');
for (let i = 0; i < 64; i++) {
  const v = slice.readUInt32LE(i * 4);
  process.stdout.write(`${v.toString(16).padStart(8,'0')} `);
  if ((i+1) % 8 === 0) process.stdout.write('\n');
}
