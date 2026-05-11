// Session 23: characterize the 8-byte high-entropy records in the "hash blob".
// Hypothesis options:
//  (a) Per-faction (239) state hashes — 239 * 8 = 1912 bytes, not 2312. (refuted by count)
//  (b) Per-character AI state hashes — would need ~289 living characters. Plausible.
//  (c) Per-region AI decision hashes — 239 + 50 padding?
//  (d) Truly cryptographic randomness seeds — for AI strategic-decision PRNG.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const RoR_T1 = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav';

const buf10 = fs.readFileSync(SAVE);
const bufT1 = fs.readFileSync(RoR_T1);

// rome10: high-entropy zone 0x1f43898..0x1f441a0
// RoR-T1: high-entropy zone 0x1f1ae35..0x1f1b73d (extrapolating from header offset shift)

// Find the proper high-entropy zone start in each file: walk backwards from header_off-16 until entropy drops
function findHighEntropyBoundaries(buf, headerOff) {
  // End of high-entropy = self-ptr at headerOff - 16 (which is the start of "value=3 transition zone")
  // Start of high-entropy = walk backward from headerOff - 16 until entropy drops
  function entropy256(off) {
    const freq = new Uint32Array(256);
    for (let i = 0; i < 256; i++) freq[buf[off + i]]++;
    let H = 0;
    for (const f of freq) {
      if (f === 0) continue;
      const p = f / 256;
      H -= p * Math.log2(p);
    }
    return H;
  }
  // Start with end ≈ headerOff - 256 (above the prior structured zone)
  // Walk backward from headerOff in 256B chunks
  let end = headerOff - 256;
  let start = end;
  while (start - 256 > 0 && entropy256(start - 256) > 6.5) start -= 256;
  return { start, end };
}

const hdr10 = 0x1f442de;
const hdrT1 = 0x1f1b87b;

const r10 = findHighEntropyBoundaries(buf10, hdr10);
const rT1 = findHighEntropyBoundaries(bufT1, hdrT1);

console.log(`=== rome10 high-entropy zone ===`);
console.log(`  Start: 0x${r10.start.toString(16)}, End: 0x${r10.end.toString(16)}, Size: ${r10.end - r10.start} bytes`);
console.log(`  If 8B records: ${(r10.end - r10.start) / 8} records`);
console.log(`  If 16B records: ${(r10.end - r10.start) / 16} records`);

console.log(`\n=== RoR-T1 high-entropy zone ===`);
console.log(`  Start: 0x${rT1.start.toString(16)}, End: 0x${rT1.end.toString(16)}, Size: ${rT1.end - rT1.start} bytes`);
console.log(`  If 8B records: ${(rT1.end - rT1.start) / 8} records`);
console.log(`  If 16B records: ${(rT1.end - rT1.start) / 16} records`);

// Compare: are the byte values DIFFERENT between rome10 and RoR-T1?
// If so, the data is dynamic per-turn (random-seed-state).
// Sample first 32B of each:
console.log(`\n=== First 32B of high-entropy zone ===`);
console.log(`  rome10 @ 0x${r10.start.toString(16)}: ${buf10.subarray(r10.start, r10.start + 32).toString('hex')}`);
console.log(`  RoR-T1 @ 0x${rT1.start.toString(16)}: ${bufT1.subarray(rT1.start, rT1.start + 32).toString('hex')}`);

// Compute byte-level overlap: are any 8B records shared?
function extract8B(buf, start, end) {
  const set = new Set();
  for (let i = 0; i < (end - start) / 8; i++) {
    set.add(buf.subarray(start + i * 8, start + (i + 1) * 8).toString('hex'));
  }
  return set;
}
const s10 = extract8B(buf10, r10.start, r10.end);
const sT1 = extract8B(bufT1, rT1.start, rT1.end);
console.log(`\nrome10: ${s10.size} unique 8B records`);
console.log(`RoR-T1: ${sT1.size} unique 8B records`);

let inter = 0;
for (const k of s10) if (sT1.has(k)) inter++;
console.log(`Intersection: ${inter} records shared between rome10 and RoR-T1`);

// Per-soldier 3-byte stat dump: look at the very first unit record and decode each soldier
const tailStart = 0x1f10c72;
// Find first unit record matching "thracian peltasts"
let pelt0 = -1;
for (let p = tailStart; p < tailStart + 0x10000; p++) {
  const len = buf10.readUInt16LE(p);
  if (len === 17 && buf10.subarray(p+2, p+2+17).toString('ascii') === 'thracian peltasts') {
    pelt0 = p;
    break;
  }
}
console.log(`\n=== "thracian peltasts"[0] at 0x${pelt0.toString(16)} ===`);

// Per session 22: after ASCII name, structure is:
// [0xee + 8B hash + 8B uuid + 0x0001012c + 0x00000001 + u16 settLen + UTF-16LE sett + 0xffffffff + 44B header + N×9B soldier + 0xff pad]
// So for thracian peltasts (len=17), after = pelt0 + 2 + 17 = pelt0 + 19
// 0xee at +19, 8B hash, 8B uuid, 4B 0001012c, 4B 00000001 = 26 bytes
// then u16 settLen, UTF-16LE settlement
let after = pelt0 + 2 + 17;
const eeMarker = buf10[after];
console.log(`  After name (0x${after.toString(16)}): 0xee marker = ${eeMarker.toString(16)}`);
const hash = buf10.subarray(after + 1, after + 9).toString('hex');
const uuid = buf10.subarray(after + 9, after + 17).toString('hex');
console.log(`  hash=${hash}, uuid=${uuid}`);
const settLenOff = after + 25;
const settLen = buf10.readUInt16LE(settLenOff);
console.log(`  settLen at 0x${settLenOff.toString(16)} = ${settLen}`);
let settName = '';
for (let i = 0; i < settLen; i++) settName += String.fromCharCode(buf10[settLenOff + 2 + i * 2]);
console.log(`  settlement: '${settName}'`);
const ffMarkerOff = settLenOff + 2 + settLen * 2;
console.log(`  0xffffffff marker at 0x${ffMarkerOff.toString(16)} = ${buf10.readUInt32LE(ffMarkerOff).toString(16)}`);

// 44B header starts at ffMarkerOff (which IS the 0xffffffff at +0 of header)
const hdrStart = ffMarkerOff;
const soldStart = hdrStart + 44;
console.log(`  44B header at 0x${hdrStart.toString(16)}: ${buf10.subarray(hdrStart, hdrStart + 44).toString('hex')}`);

console.log(`\n  First 30 soldier records (9B each from 0x${soldStart.toString(16)}):`);
for (let i = 0; i < 30; i++) {
  const so = soldStart + i * 9;
  const r = buf10.subarray(so, so + 9);
  console.log(`    sold[${i}] @ 0x${so.toString(16)}: ${r.toString('hex')}  bytes: state=${r[0]}, b1=${r[1]}, b2=${r[2]}, b3=${r[3]}, pad=${r.subarray(4, 9).toString('hex')}`);
}

// Compute byte distributions across all 200 soldiers
console.log(`\n  Byte-position distribution across all 200 soldiers of thracian peltasts[0]:`);
const byPos = Array.from({ length: 9 }, () => new Map());
for (let i = 0; i < 200; i++) {
  for (let b = 0; b < 9; b++) {
    const v = buf10[soldStart + i * 9 + b];
    byPos[b].set(v, (byPos[b].get(v) || 0) + 1);
  }
}
for (let b = 0; b < 9; b++) {
  const dist = [...byPos[b].entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const distStr = dist.map(([v, c]) => `${v}(×${c})`).join(', ');
  console.log(`    byte +${b}: distinct=${byPos[b].size}  top: ${distStr}`);
}
