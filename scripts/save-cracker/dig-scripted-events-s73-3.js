// Session 73 — Find the boundary between the named-events section and the tail.
// Find: where does the last named record end, and what's the stride of tail records?
// dig-scripted-events7 already found 20B records ending in 0xff 0xff 0xff 0xff 0x00 0x01 delimiter.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAV);

const START = 0x846af, END = 0xa8beb;

function readPstr16(o) {
  if (o + 2 > END) return null;
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 < 2 || lenP1 > 128) return null;
  if (o + 2 + lenP1 > END) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[o + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(o + 2, o + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// All pstr16+pstr16 pairs
const pairs = [];
for (let o = START; o < END - 4; o++) {
  const r1 = readPstr16(o);
  if (!r1) continue;
  const r2 = readPstr16(o + r1.totalLen);
  if (!r2) continue;
  pairs.push({off: o, cat: r1.str, name: r2.str, catLen: r1.totalLen, nameLen: r2.totalLen});
  o += r1.totalLen + r2.totalLen - 1;
}
console.log('Pairs: ' + pairs.length);

// All pair offsets sorted
const pairOffs = pairs.map(p=>p.off);

// Compute payload start (after strings) and payload end (next pair off)
for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i];
  const stringsEnd = p.off + p.catLen + p.nameLen;
  const nextOff = i + 1 < pairs.length ? pairs[i+1].off : END;
  const payloadLen = nextOff - stringsEnd;
  console.log('  rec[' + i + '] @0x' + p.off.toString(16).padStart(6,'0') + ' "' + p.cat + '/' + p.name + '" payload=' + payloadLen + 'B');
}

// Now check what's after the LAST pair's record
const last = pairs[pairs.length - 1];
const lastStringsEnd = last.off + last.catLen + last.nameLen;
console.log('\nLast pair strings end at 0x' + lastStringsEnd.toString(16));
console.log('Remaining tail: ' + (END - lastStringsEnd) + ' bytes');

// Examine end of last record — is there a trailer that closes the named-records section?
// Then tail starts somewhere. Let me find the next structure marker.

// Search for repeating 6-byte delimiter pattern ff ff ff ff (00|01) 01 in the tail
const matches = [];
for (let o = lastStringsEnd; o < END - 6; o++) {
  if (buf[o]===0xff && buf[o+1]===0xff && buf[o+2]===0xff && buf[o+3]===0xff
      && (buf[o+4]===0x00 || buf[o+4]===0x01) && buf[o+5]===0x01) {
    matches.push(o);
  }
}
console.log('\nff ff ff ff (00|01) 01 delimiters in tail: ' + matches.length);
console.log('First 5: ' + matches.slice(0,5).map(o=>'0x' + o.toString(16)).join(', '));
console.log('Last 5: ' + matches.slice(-5).map(o=>'0x' + o.toString(16)).join(', '));

// Stride
if (matches.length > 1) {
  const ds = [];
  for (let i=1; i<matches.length; i++) ds.push(matches[i] - matches[i-1]);
  const dh = {};
  ds.forEach(d=>dh[d]=(dh[d]||0)+1);
  console.log('Stride distribution (top 10):');
  Object.entries(dh).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([s,c])=>console.log('  Δ=' + s + ' bytes: ' + c));
}

// Now from the last named pair: 0x84ee0. Last strings end 0x84efc.
// Then 0x84efc...some bytes...first delimiter
// Find first delimiter at...
console.log('\nFirst delimiter at: 0x' + matches[0].toString(16));
console.log('Distance from last strings end: ' + (matches[0] - lastStringsEnd));

// So named-records area ends at lastStringsEnd + 33 = 0x84f1d (the payload length of the last record).
// But session 26 said tail records start at 0x84f1c. Let me re-examine.

// Check: is the payload of the LAST named record actually 33B same as others?
// last is rec[33]: flood/flood_in_rome_241 at 0x84ee0, strings end 0x84efc, payloadLen = nextOff - stringsEnd
// nextOff = END for last, so payloadLen = END - 0x84efc = 146671
// Therefore actual record boundary is unclear from this script's loop

// The stride from rec[32] to rec[33]:
const r32 = pairs[32];
const r33 = pairs[33];
console.log('\nrec[32]->rec[33] stride: ' + (r33.off - r32.off));
console.log('rec[32] payload (rec[33] off - rec[32] strings end): ' + (r33.off - (r32.off + r32.catLen + r32.nameLen)));

// Look at the bytes from 0x84efc..0x84f1d (33 bytes of last record's payload)
console.log('\nLast record payload (33B expected):');
for (let o = 0x84efc; o < 0x84efc + 64; o += 16) {
  const slice = buf.subarray(o, o + 16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// Tail begins at 0x84efc + 33 = 0x84f1d.
// Compare to dig-scripted-events7 which used REGION_START=0x84f1c (off by 1).

// Check what's at 0x84f1d
console.log('\n0x84f1d bytes:');
const tailStart = 0x84efc + 33;
for (let o = tailStart; o < tailStart + 96; o += 16) {
  const slice = buf.subarray(o, o + 16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// Count records in tail using 20B + 6B delimiter walking
console.log('\n=== Counting tail records ===');
let tcount = 0;
let p = tailStart;
while (p + 26 <= END) {
  // record body = 20B, then 6B delimiter: ff ff ff ff (00|01) 01
  if (buf[p+20]===0xff && buf[p+21]===0xff && buf[p+22]===0xff && buf[p+23]===0xff
      && (buf[p+24]===0x00 || buf[p+24]===0x01) && buf[p+25]===0x01) {
    tcount++;
    p += 26;
  } else {
    // Maybe stride differs — try next
    break;
  }
}
console.log('Tail 26B records starting at 0x' + tailStart.toString(16) + ': ' + tcount);
console.log('Ended at p=0x' + p.toString(16) + ' (END=0x' + END.toString(16) + ')');
console.log('Remaining tail-of-tail: ' + (END - p));

// If clean walk works, perfect — record = 26B * 5632 = 146432 -> 146671 - 146432 = 239 bytes tail-of-tail

// dump first few tail records
console.log('\nFirst 4 tail records:');
for (let i = 0; i < 4; i++) {
  const recStart = tailStart + i * 26;
  const slice = buf.subarray(recStart, recStart + 26);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  [' + i + '] 0x' + recStart.toString(16) + ': ' + hex);
}
