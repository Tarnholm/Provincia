// Initial probe of vanilla Alexander expansion saves.
// Three turn-1 saves with different sieges issued by the player.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVES = [
  ['baseline',         BASE + 'save_17-05-2026   Macedon   Turn 1.sav'],
  ['besige_fort',      BASE + 'save_17-05-2026   Macedon   Turn 1 besige fort.sav'],
  ['besige_byzantium', BASE + 'save_17-05-2026   Macedon   Turn 1 besige Byzantium.sav'],
];

function readHeader(buf) {
  const magic = buf.readUInt16LE(0);
  const turn = buf.readUInt32LE(0x44e3) + 1;  // RIS offset — may not apply
  const year = buf.readInt32LE(0x44e7);
  // Also check older RIS offsets
  return { magic: '0x' + magic.toString(16), size: buf.length, turn, year };
}

console.log('=== Header probes ===');
for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) { console.log('MISSING', tag); continue; }
  const buf = fs.readFileSync(p);
  const h = readHeader(buf);
  console.log(tag.padEnd(20) + '  size=' + h.size + '  magic=' + h.magic + '  turn=' + h.turn + '  year=' + h.year);
}

// Compare campaign name at the expected position (Remastered: 0x3a)
console.log('\n=== Campaign name lookup ===');
for (const [tag, p] of SAVES) {
  const buf = fs.readFileSync(p);
  // Try RIS imperial location (0x3a)
  const campLen = buf.readUInt16LE(0x3a);
  if (campLen > 0 && campLen < 64) {
    const chars = [];
    for (let i = 0; i < campLen; i++) {
      chars.push(String.fromCharCode(buf.readUInt16LE(0x3c + i * 2)));
    }
    console.log(tag.padEnd(20) + '  campaign="' + chars.join('') + '"');
  } else {
    // Try classic-RTW (no GUID) location
    const campLen2 = buf.readUInt16LE(0x36);
    if (campLen2 > 0 && campLen2 < 64) {
      const chars = [];
      for (let i = 0; i < campLen2; i++) {
        chars.push(String.fromCharCode(buf.readUInt16LE(0x38 + i * 2)));
      }
      console.log(tag.padEnd(20) + '  campaign="' + chars.join('') + '" (classic offset)');
    } else {
      console.log(tag.padEnd(20) + '  ??? no campaign name found');
    }
  }
}

// Diff baseline vs besige_fort
const A = fs.readFileSync(SAVES[0][1]);
const B = fs.readFileSync(SAVES[1][1]);
const C = fs.readFileSync(SAVES[2][1]);

function diff(a, b) {
  const RESYNC_WINDOW = 64;
  const RESYNC_RUN = 16;
  const findResync = (aOff, bOff) => {
    for (let shift = 0; shift <= RESYNC_WINDOW; shift++) {
      for (const sign of [+1, -1]) {
        const s = shift * sign;
        const aBase = aOff;
        const bBase = bOff + s;
        if (bBase < 0 || bBase + RESYNC_RUN > b.length) continue;
        if (aBase + RESYNC_RUN > a.length) continue;
        let ok = true;
        for (let k = 0; k < RESYNC_RUN; k++) {
          if (a[aBase + k] !== b[bBase + k]) { ok = false; break; }
        }
        if (ok) return { aOff: aBase, bOff: bBase, shift: s };
        if (shift === 0) break;
      }
    }
    return null;
  };
  const diffs = [];
  let i = 0, j = 0;
  let inDiff = false;
  let diffStartA = 0, diffStartB = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      if (inDiff) { diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB }); inDiff = false; }
      i++; j++;
    } else {
      if (!inDiff) { diffStartA = i; diffStartB = j; inDiff = true; }
      const r = findResync(i, j);
      if (r) {
        diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: r.aOff - diffStartA, lenB: r.bOff - diffStartB });
        i = r.aOff; j = r.bOff; inDiff = false;
      } else { i++; j++; }
    }
  }
  if (inDiff) diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB });
  // Cluster (gap≤32)
  const clusters = [];
  let cur = null;
  for (const d of diffs) {
    if (!cur || d.aOff - cur.aEnd > 32) {
      if (cur) clusters.push(cur);
      cur = { aStart: d.aOff, aEnd: d.aOff + d.lenA, bStart: d.bOff, bEnd: d.bOff + d.lenB, totalA: d.lenA, totalB: d.lenB, spans: 1 };
    } else {
      cur.aEnd = d.aOff + d.lenA;
      cur.bEnd = d.bOff + d.lenB;
      cur.totalA += d.lenA;
      cur.totalB += d.lenB;
      cur.spans++;
    }
  }
  if (cur) clusters.push(cur);
  return clusters;
}

console.log('\n=== baseline → besige_fort diff (+' + (B.length - A.length) + ' bytes) ===');
const cAB = diff(A, B);
console.log('Clusters:', cAB.length);
const sortedAB = cAB.slice().sort((x, y) => (y.totalA + y.totalB) - (x.totalA + x.totalB));
for (let k = 0; k < Math.min(20, sortedAB.length); k++) {
  const c = sortedAB[k];
  console.log('  #' + k + '  0x' + c.aStart.toString(16).padStart(7, '0') +
              '  spans=' + c.spans + '  lenA=' + c.totalA + ' lenB=' + c.totalB + '  Δ=' + (c.totalB - c.totalA));
}

console.log('\n=== besige_fort → besige_byzantium diff (+' + (C.length - B.length) + ' bytes) ===');
const cBC = diff(B, C);
console.log('Clusters:', cBC.length);
const sortedBC = cBC.slice().sort((x, y) => (y.totalA + y.totalB) - (x.totalA + x.totalB));
for (let k = 0; k < Math.min(20, sortedBC.length); k++) {
  const c = sortedBC[k];
  console.log('  #' + k + '  0x' + c.aStart.toString(16).padStart(7, '0') +
              '  spans=' + c.spans + '  lenA=' + c.totalA + ' lenB=' + c.totalB + '  Δ=' + (c.totalB - c.totalA));
}

// Dump top cluster context for both diffs
function dump(label, buf, off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}

if (sortedAB.length > 0) {
  const c = sortedAB[0];
  console.log('\n=== Top AB cluster context (besige_fort) ===');
  dump('A', A, c.aStart - 16, 200);
  console.log('-');
  dump('B', B, c.bStart - 16, 250);
}
if (sortedBC.length > 0) {
  const c = sortedBC[0];
  console.log('\n=== Top BC cluster context (besige_byzantium) ===');
  dump('B', B, c.aStart - 16, 200);
  console.log('-');
  dump('C', C, c.bStart - 16, 250);
}

// Search for "Byzantium" UTF-16 in each save
const needle = Buffer.from([0x42, 0x00, 0x79, 0x00, 0x7a, 0x00, 0x61, 0x00, 0x6e, 0x00, 0x74, 0x00, 0x69, 0x00, 0x75, 0x00, 0x6d, 0x00]);
const findUtf16 = (buf, str) => {
  const arr = [...str].flatMap(c => [c.charCodeAt(0), 0]);
  const needle = Buffer.from(arr);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
};
console.log('\n=== "Byzantium" UTF-16 occurrences ===');
console.log('A (baseline):', findUtf16(A, 'Byzantium').map(o => '0x' + o.toString(16)));
console.log('B (fort):    ', findUtf16(B, 'Byzantium').map(o => '0x' + o.toString(16)));
console.log('C (Byz):     ', findUtf16(C, 'Byzantium').map(o => '0x' + o.toString(16)));
console.log('\nAlso "besiege" / "siege" UTF-16:');
console.log('A:', findUtf16(A, 'siege').length, 'B:', findUtf16(B, 'siege').length, 'C:', findUtf16(C, 'siege').length);
console.log('A:', findUtf16(A, 'Siege').length, 'B:', findUtf16(B, 'Siege').length, 'C:', findUtf16(C, 'Siege').length);
