// Vanilla Rome tabulation including diplomatic trade offer.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

function readCounters(buf) {
  return {
    year:   buf.readInt32LE(0x514),
    evtCtr: buf.readUInt32LE(0xefd),
  };
}

console.log('tag'.padEnd(45) + '  size       year   evtCtr');
const bufs = {};
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const tag = f.replace(/^save_/, '').replace(/\.sav$/, '');
  bufs[tag] = buf;
  const c = readCounters(buf);
  console.log(tag.padEnd(45) + '  ' + buf.length.toString().padStart(8) +
              '  ' + c.year.toString().padStart(5) +
              '  ' + c.evtCtr.toString().padStart(8));
}

console.log('\n=== Pairwise deltas vs baseline ===');
const baselineTag = Object.keys(bufs).find(k => k.includes('Turn 1') && !k.includes('move') && !k.includes('Autosave'));
const baseline = bufs[baselineTag];
const bc = readCounters(baseline);
console.log('Baseline:', baselineTag);
for (const [tag, buf] of Object.entries(bufs)) {
  if (tag === baselineTag) continue;
  const c = readCounters(buf);
  const δsize = buf.length - baseline.length;
  const δctr = c.evtCtr - bc.evtCtr;
  console.log('  ' + tag.padEnd(45) + '  Δsize=' + (δsize >= 0 ? '+' : '') + δsize.toString().padStart(6) +
              '  Δyear=' + (c.year - bc.year).toString().padStart(2) +
              '  Δctr=' + (δctr >= 0 ? '+' : '') + δctr.toString().padStart(5));
}

// Identify the trade-offer-accepted save and find what changed
const tradeTag = Object.keys(bufs).find(k => k.includes('trade'));
const t2startTag = Object.keys(bufs).find(k => k.includes('Turn 2 Start'));

if (tradeTag && t2startTag) {
  console.log('\n=== Trade offer accepted (vs T2 Start) ===');
  const a = bufs[t2startTag], b = bufs[tradeTag];
  console.log('Sizes:', a.length, '→', b.length, 'Δ=' + (b.length - a.length));
  console.log('Counter:', a.readUInt32LE(0xefd), '→', b.readUInt32LE(0xefd), 'Δ=' + (b.readUInt32LE(0xefd) - a.readUInt32LE(0xefd)));

  // Front/back diff alignment
  let frontDiff = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) { frontDiff = i; break; }
  }
  let backDiff = -1;
  let ai = a.length - 1, bi = b.length - 1;
  while (ai >= 0 && bi >= 0) {
    if (a[ai] !== b[bi]) { backDiff = bi; break; }
    ai--; bi--;
  }
  console.log('First diff: 0x' + frontDiff.toString(16) + '  Last diff (in B): 0x' + backDiff.toString(16));

  // Show context of last diff (often the structural addition)
  console.log('\nContext around last diff (in B, the trade-accepted save):');
  const start = Math.max(0, backDiff - 80);
  const end = Math.min(b.length, backDiff + 80);
  for (let o = start; o < end; o += 16) {
    const slice = b.subarray(o, Math.min(o + 16, end));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }

  // Carthage occurrences in both
  function findUtf16(buf, str) {
    const needle = Buffer.from([...str].flatMap(c => [c.charCodeAt(0), 0]));
    const hits = [];
    let p = 0;
    while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
    return hits;
  }
  console.log('\n"Carthage" UTF-16 in T2 Start:', findUtf16(a, 'Carthage').length);
  console.log('"Carthage" UTF-16 in trade accepted:', findUtf16(b, 'Carthage').length);
  console.log('"Trade" UTF-16 in T2 Start:', findUtf16(a, 'Trade').length);
  console.log('"Trade" UTF-16 in trade accepted:', findUtf16(b, 'Trade').length);
}
