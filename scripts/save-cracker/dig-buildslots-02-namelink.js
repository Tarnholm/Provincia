// dig-buildslots-02-namelink.js
// The "name 18 bytes before default_set" heuristic from the Spain save fails on
// save_macedon t0. Investigate the bytes around the FIRST few default_set
// markers to find the settlement UTF-16 name and the exact gap.

const fs = require('fs');
const path = require('path');

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(SAVE_BASE, 'save_macedon t0.sav'));

function readPstr16Utf16(b, off) {
  if (off + 2 > b.length) return null;
  const len = b.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > b.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = b.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(b, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = b.indexOf(target, p)) !== -1) { hits.push(p); p++; }
  return hits;
}

function hex(b, off, n) {
  return Array.from(b.slice(off, off + n)).map(x => x.toString(16).padStart(2, '0')).join(' ');
}

const defSets = findPstr16Asciiz(buf, 'default_set');
console.log('default_set markers: ' + defSets.length);

// For the first 6 default_set markers, scan backward up to 64 bytes for any
// readable UTF-16 pstr16 ending exactly N bytes before the marker.
console.log('\n=== Backward UTF-16 name scan for first 8 default_set markers ===');
for (let i = 0; i < Math.min(8, defSets.length); i++) {
  const ds = defSets[i];
  console.log('\n--- default_set @ 0x' + ds.toString(16) + ' ---');
  console.log('  64 bytes BEFORE: ' + hex(buf, ds - 64, 64));
  // try every start within -80..-4
  let found = [];
  for (let c = ds - 80; c < ds - 2; c++) {
    const r = readPstr16Utf16(buf, c);
    if (r && /^[A-Z][A-Za-z' -]+$/.test(r.str) && r.str.length >= 3) {
      found.push({ off: c, gap: ds - (c + r.totalLen), str: r.str });
    }
  }
  if (found.length === 0) console.log('  (no UTF-16 name found within -80)');
  for (const f of found) console.log('  name "' + f.str + '" @ 0x' + f.off.toString(16) + '  gap-to-default_set=' + f.gap);
}

// Also: tabulate the gap distribution across ALL markers (best UTF-16 name found)
console.log('\n=== Gap distribution (UTF-16 name -> default_set) across ALL markers ===');
const gapDist = {};
let withName = 0;
for (const ds of defSets) {
  let best = null;
  for (let c = ds - 80; c < ds - 2; c++) {
    const r = readPstr16Utf16(buf, c);
    if (r && /^[A-Z][A-Za-z' -]+$/.test(r.str) && r.str.length >= 3) {
      const gap = ds - (c + r.totalLen);
      if (best === null || gap < best.gap) best = { gap, str: r.str };
    }
  }
  if (best) { withName++; gapDist[best.gap] = (gapDist[best.gap] || 0) + 1; }
}
console.log('markers with a UTF-16 name nearby: ' + withName + ' / ' + defSets.length);
for (const [g, c] of Object.entries(gapDist).sort((a, b) => b[1] - a[1])) {
  console.log('  gap=' + g + ': ' + c + ' markers');
}
