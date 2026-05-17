// Session 73 — Implement the decode/encode pair and test it standalone before
// wiring into serialize.js.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAV);

const START = 0x846af, END = 0xa8beb;

function readPstr16(buf, o, hardEnd) {
  if (o + 2 > hardEnd) return null;
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 < 2 || lenP1 > 128) return null;
  if (o + 2 + lenP1 > hardEnd) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[o + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(o + 2, o + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

function decode(buf, start, end) {
  // 1. Walk pair offsets.
  const pairOffs = [];
  for (let o = start; o < end - 4; o++) {
    const r1 = readPstr16(buf, o, end);
    if (!r1) continue;
    const r2 = readPstr16(buf, o + r1.totalLen, end);
    if (!r2) continue;
    pairOffs.push({off: o, cat: r1.str, name: r2.str, catTotal: r1.totalLen, nameTotal: r2.totalLen});
    o += r1.totalLen + r2.totalLen - 1;
  }
  if (pairOffs.length === 0) throw new Error('No string pairs found');

  // 2. Header bytes = section start to first pair off
  const headerBytes = Buffer.from(buf.slice(start, pairOffs[0].off));

  // 3. For each named record, payload = bytes from stringsEnd to nextPairOff (or section end for last).
  // For the LAST record, we need to find where the named section ENDS and the tail begins.
  // Tail records are 26B fixed with ff ff ff ff at offset +22. Find the first such position
  // AFTER the last named pair's stringsEnd.
  const lastPair = pairOffs[pairOffs.length - 1];
  const lastStringsEnd = lastPair.off + lastPair.catTotal + lastPair.nameTotal;
  // Locate first tail-record by scanning for ff ff ff ff at +22, with the candidate offset
  // being 26B-aligned with subsequent records. Easiest: scan forward and check that the
  // pattern holds at +22 and again at +22+26 (next record).
  let tailStart = -1;
  for (let p = lastStringsEnd; p + 52 <= end; p++) {
    if (buf[p+22]===0xff && buf[p+23]===0xff && buf[p+24]===0xff && buf[p+25]===0xff
        && buf[p+22+26]===0xff && buf[p+23+26]===0xff && buf[p+24+26]===0xff && buf[p+25+26]===0xff) {
      tailStart = p;
      break;
    }
  }
  if (tailStart < 0) throw new Error('Could not locate tail section');

  const records = [];
  for (let i = 0; i < pairOffs.length; i++) {
    const p = pairOffs[i];
    const stringsEnd = p.off + p.catTotal + p.nameTotal;
    const payloadEnd = i + 1 < pairOffs.length ? pairOffs[i+1].off : tailStart;
    const payload = Buffer.from(buf.slice(stringsEnd, payloadEnd));
    records.push({ category: p.cat, name: p.name, payload });
  }

  // 4. Trailer = everything from tailStart to end (5633 tail records + wonders).
  const trailerBytes = Buffer.from(buf.slice(tailStart, end));

  return {
    _kind: 'scripted-events',
    headerBytes,
    records,
    trailerBytes,
  };
}

function encode(obj) {
  if (obj._kind !== 'scripted-events') throw new Error('not scripted-events');
  const chunks = [obj.headerBytes];
  for (const r of obj.records) {
    const catBuf = Buffer.from(r.category + '\0', 'latin1');
    const nameBuf = Buffer.from(r.name + '\0', 'latin1');
    const catRec = Buffer.alloc(2 + catBuf.length);
    catRec.writeUInt16LE(catBuf.length, 0);
    catBuf.copy(catRec, 2);
    const nameRec = Buffer.alloc(2 + nameBuf.length);
    nameRec.writeUInt16LE(nameBuf.length, 0);
    nameBuf.copy(nameRec, 2);
    chunks.push(catRec, nameRec, r.payload);
  }
  chunks.push(obj.trailerBytes);
  return Buffer.concat(chunks);
}

// Test
const dec = decode(buf, START, END);
console.log('Records: ' + dec.records.length);
console.log('Header bytes: ' + dec.headerBytes.length);
console.log('Trailer bytes: ' + dec.trailerBytes.length);
console.log('First record: cat="' + dec.records[0].category + '" name="' + dec.records[0].name + '" payload=' + dec.records[0].payload.length + 'B');
console.log('Last record: cat="' + dec.records[dec.records.length-1].category + '" name="' + dec.records[dec.records.length-1].name + '" payload=' + dec.records[dec.records.length-1].payload.length + 'B');

const enc = encode(dec);
console.log('Encoded size: ' + enc.length);
console.log('Expected size: ' + (END - START));

// Byte-by-byte compare
const original = buf.slice(START, END);
let identical = enc.length === original.length;
let firstDiff = -1;
if (identical) {
  for (let i = 0; i < enc.length; i++) {
    if (enc[i] !== original[i]) { identical = false; firstDiff = i; break; }
  }
}
console.log('\nByte-identical: ' + identical);
if (!identical) {
  console.log('First diff at relative offset ' + firstDiff + ' (absolute 0x' + (START + firstDiff).toString(16) + ')');
  console.log('Expected: 0x' + original[firstDiff].toString(16));
  console.log('Got:      0x' + enc[firstDiff].toString(16));
}
