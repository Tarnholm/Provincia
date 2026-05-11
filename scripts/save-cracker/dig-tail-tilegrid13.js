// dig-tail-tilegrid13.js — Decode multiple records and check their spatial centroids
// to see if these are per-faction shroud / region masks.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";

const buf = fs.readFileSync(ROME10);

// Find all 239 records
const records = [];
for (let p = 0x1f00000; p < buf.length - 16; p++) {
  if (buf[p] === 0xf0 && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
    const a = buf.readUInt32LE(p + 4);
    const b = buf.readUInt32LE(p + 8);
    if (a === 0x3fc && b === 0x2bc) records.push(p - 8);
  }
}
console.log(`Records: ${records.length}`);

const W = 1020, H = 700;

function decodeRecord(p, nextP) {
  const payloadStart = p + 20;  // skip [selfPtr][selfPtr+4][magic][1020][700]
  const payloadEnd = nextP;
  const mask = new Uint8Array(W * H);
  let cursor = 0;
  let badCells = 0;
  for (let q = payloadStart; q < payloadEnd - 1; q += 2) {
    const cell = buf.readUInt16LE(q);
    const value = cell & 0xff;
    const count = (cell >> 8) & 0xff;
    for (let k = 0; k < count && cursor < mask.length; k++) {
      mask[cursor++] = value;
    }
    if (cursor >= mask.length) break;
  }
  // Stats
  let nonZero = 0, sumX = 0, sumY = 0;
  let bbox = { minX: W, maxX: 0, minY: H, maxY: 0 };
  const valSet = new Set();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = mask[y * W + x];
      if (v !== 0) {
        nonZero++;
        sumX += x; sumY += y;
        if (x < bbox.minX) bbox.minX = x;
        if (x > bbox.maxX) bbox.maxX = x;
        if (y < bbox.minY) bbox.minY = y;
        if (y > bbox.maxY) bbox.maxY = y;
        valSet.add(v);
      }
    }
  }
  return {
    cursor, nonZero,
    centroid: nonZero > 0 ? { x: sumX / nonZero, y: sumY / nonZero } : null,
    bbox, distinctValues: valSet.size, mask
  };
}

// Process all 239 records and report centroid + bbox
console.log(`\nFor each record: nonZero count and centroid:`);
console.log(`idx\tlen\tcells\tcentroidX\tcentroidY\tbbox`);
for (let i = 0; i < records.length; i++) {
  const p = records[i];
  const nextP = i + 1 < records.length ? records[i + 1] : buf.length;
  // Strip the "header" bytes belonging to the NEXT record (typically 24 bytes back from next)
  const payloadStart = p + 20;
  // We need to find the actual end of this record's RLE data. The payload ends right before
  // the next record's preamble (which is 24 bytes of header before its self-ptr).
  const payloadEnd = nextP > 24 ? nextP - 24 : nextP;
  const recLen = payloadEnd - payloadStart;
  if (recLen < 0) continue;
  const r = decodeRecord(p, payloadEnd);
  const ctd = r.centroid ? `(${r.centroid.x.toFixed(0)},${r.centroid.y.toFixed(0)})` : "-";
  const bb = `[${r.bbox.minX}..${r.bbox.maxX},${r.bbox.minY}..${r.bbox.maxY}]`;
  if (i < 30 || i === records.length - 1 || r.nonZero > 5000) {
    console.log(`${i}\t${recLen}\t${r.nonZero}\t${ctd}\t${bb}\tdistinct=${r.distinctValues}`);
  }
}
