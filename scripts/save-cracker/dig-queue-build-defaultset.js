// dig-queue-build-defaultset.js
// Focus the construction-queue diff on default_set chains only.
// Compare every default_set chain body between base and building-queued saves;
// report the chain whose body GREW (the building entry was inserted there).

'use strict';
const fs = require('fs');
const path = require('path');

const ALEX = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Alexander', 'saves'
);

const A = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1.sav'));
const B = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'));

const DS = Buffer.from('default_set\0', 'latin1');
function allDS(buf) { const o = []; let i = 0; while ((i = buf.indexOf(DS, i)) !== -1) { o.push(i); i++; } return o; }

// Find the next chain preamble (size=0x0c self-ptr) to bound a chain body.
function chainBodyEnd(buf, bodyStart) {
  const end = Math.min(bodyStart + 300, buf.length - 10);
  for (let i = bodyStart + 30; i < end; i++) {
    if (buf.readUInt32LE(i) !== 0x0c) continue;
    if (buf.readUInt32LE(i + 4) !== i + 4) continue;
    const nl = buf.readUInt16LE(i + 8);
    if (nl < 4 || nl > 64) continue;
    return i;
  }
  return -1;
}

const dsA = allDS(A), dsB = allDS(B);
console.log('default_set count: base=' + dsA.length + ' bldg=' + dsB.length);

// Match default_set chains by their chain uuid (bodyStart+4) to be robust to shifts.
function chainInfo(buf, dsOffs) {
  return dsOffs.map(off => {
    const bs = off + 12;
    if (buf.readUInt32LE(bs + 8) !== 0xfcfcfcfc) return null;
    const uuid = buf.readUInt32LE(bs + 4);
    const endP = chainBodyEnd(buf, bs);
    const bodyLen = endP < 0 ? -1 : (endP - bs);
    return { off, bs, uuid, bodyLen };
  }).filter(Boolean);
}

const ciA = chainInfo(A, dsA);
const ciB = chainInfo(B, dsB);
const mapA = new Map(ciA.map(c => [c.uuid, c]));

console.log('\n=== Chains whose body length changed (uuid matched) ===');
for (const cb of ciB) {
  const ca = mapA.get(cb.uuid);
  if (!ca) { console.log('  uuid 0x' + cb.uuid.toString(16) + ' NEW in bldg (bodyLen=' + cb.bodyLen + ' @0x' + cb.bs.toString(16) + ')'); continue; }
  if (ca.bodyLen !== cb.bodyLen) {
    console.log('  uuid 0x' + cb.uuid.toString(16) + ': base bodyLen=' + ca.bodyLen + ' -> bldg bodyLen=' + cb.bodyLen +
      '  (base@0x' + ca.bs.toString(16) + '  bldg@0x' + cb.bs.toString(16) + ')');
  }
}

// For each changed chain, dump base vs bldg bodies aligned.
console.log('\n=== Detail of grown chains ===');
for (const cb of ciB) {
  const ca = mapA.get(cb.uuid);
  if (!ca || ca.bodyLen === cb.bodyLen) continue;
  console.log('\n--- uuid 0x' + cb.uuid.toString(16) + ' ---');
  const dumpBody = (buf, c, label) => {
    console.log('  ' + label + ' body (' + c.bodyLen + ' B) @0x' + c.bs.toString(16) + ':');
    for (let o = c.bs; o < c.bs + c.bodyLen; o += 16) {
      const slice = buf.slice(o, Math.min(o + 16, c.bs + c.bodyLen));
      const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
      console.log('    +' + (o - c.bs).toString().padStart(3) + ': ' + hex.padEnd(48) + ' |' + ascii + '|');
    }
  };
  dumpBody(A, ca, 'BASE');
  dumpBody(B, cb, 'BLDG');
}
