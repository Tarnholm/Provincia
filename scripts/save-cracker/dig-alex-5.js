// Battle resolution analysis. When an army is destroyed or a settlement
// captured, the save SHRINKS — content gets removed.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const SAVES = [
  ['t2_manual',         BASE + 'save_17-05-2026   Macedon   Turn 2.sav'],
  ['t2_adoption',       BASE + 'save_17-05-2026   Macedon   Turn 2 adoption.sav'],
  ['t2_attack_rebel',   BASE + 'save_17-05-2026   Macedon   Turn 2 attack rebel army.sav'],
  ['t2_clear_victory',  BASE + 'save_17-05-2026   Macedon   Turn 2 clear victory enemy army gone.sav'],
  ['t2_autoresolve_byz', BASE + 'save_Turn 2 autoresolve siege of Byz, clear victory, occupy.sav'],
];

const bufs = {};
for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) { console.log('MISSING', tag); continue; }
  bufs[tag] = fs.readFileSync(p);
}

function readCounters(buf) {
  return {
    year: buf.readInt32LE(0x504),
    evtCtr: buf.readUInt32LE(0xefd),
  };
}

console.log('save'.padEnd(22) + '  size       year   evtCtr   Δsize_vs_t2');
const t2 = bufs.t2_manual;
for (const [tag] of SAVES) {
  if (!bufs[tag]) continue;
  const c = readCounters(bufs[tag]);
  const δ = bufs[tag].length - t2.length;
  console.log(tag.padEnd(22) + '  ' + bufs[tag].length.toString().padStart(8) +
              '  ' + c.year.toString().padStart(5) +
              '  ' + c.evtCtr.toString().padStart(8) +
              '       ' + (δ >= 0 ? '+' : '') + δ);
}

// Find what got REMOVED in t2_attack_rebel vs t2_manual
// Walking-diff with resync
function diff(a, b) {
  const RESYNC_WINDOW = 256;
  const RESYNC_RUN = 24;
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
  // Cluster
  const clusters = [];
  let cur = null;
  for (const d of diffs) {
    if (!cur || d.aOff - cur.aEnd > 64) {
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

console.log('\n=== t2_manual → t2_attack_rebel ===');
const c1 = diff(t2, bufs.t2_attack_rebel);
const s1 = c1.slice().sort((a, b) => (b.totalA + b.totalB) - (a.totalA + a.totalB));
console.log('Top 10 clusters:');
for (let k = 0; k < 10 && k < s1.length; k++) {
  const c = s1[k];
  console.log('  #' + k + '  0x' + c.aStart.toString(16) + '  spans=' + c.spans + '  lenA=' + c.totalA + ' lenB=' + c.totalB + '  Δ=' + (c.totalB - c.totalA));
}

console.log('\n=== t2_manual → t2_clear_victory ===');
const c2 = diff(t2, bufs.t2_clear_victory);
const s2 = c2.slice().sort((a, b) => (b.totalA + b.totalB) - (a.totalA + a.totalB));
console.log('Top 10 clusters:');
for (let k = 0; k < 10 && k < s2.length; k++) {
  const c = s2[k];
  console.log('  #' + k + '  0x' + c.aStart.toString(16) + '  spans=' + c.spans + '  lenA=' + c.totalA + ' lenB=' + c.totalB + '  Δ=' + (c.totalB - c.totalA));
}

console.log('\n=== t2_manual → t2_autoresolve_byz ===');
const c3 = diff(t2, bufs.t2_autoresolve_byz);
const s3 = c3.slice().sort((a, b) => (b.totalA + b.totalB) - (a.totalA + a.totalB));
console.log('Top 10 clusters:');
for (let k = 0; k < 10 && k < s3.length; k++) {
  const c = s3[k];
  console.log('  #' + k + '  0x' + c.aStart.toString(16) + '  spans=' + c.spans + '  lenA=' + c.totalA + ' lenB=' + c.totalB + '  Δ=' + (c.totalB - c.totalA));
}

// Look for ASCII strings in t2_manual that DON'T appear in t2_clear_victory
// (these would be the "removed" rebel army's data — unit names, character names, etc.)
function findUnitNames(buf) {
  const found = [];
  for (let p = 0; p < buf.length - 4; p++) {
    const lenP1 = buf.readUInt16LE(p);
    if (lenP1 < 6 || lenP1 > 60) continue;
    if (p + 2 + lenP1 > buf.length) continue;
    let ok = true;
    for (let j = 0; j < lenP1 - 1; j++) {
      const c = buf[p + 2 + j];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    if (buf[p + 2 + lenP1 - 1] !== 0) continue;
    const s = buf.slice(p + 2, p + 2 + lenP1 - 1).toString('latin1');
    if (/^(rebel|barbarian|persian|greek|macedonian|scythian)\s/i.test(s)) {
      found.push(s);
    }
  }
  return new Set(found);
}

console.log('\n=== Faction-prefix unit names present in t2_manual but absent in t2_clear_victory ===');
const inManual = findUnitNames(bufs.t2_manual);
const inVictory = findUnitNames(bufs.t2_clear_victory);
const removed = [...inManual].filter(s => !inVictory.has(s));
console.log('Removed unit names (' + removed.length + '):');
for (const s of removed.slice(0, 20)) console.log('  "' + s + '"');
const added = [...inVictory].filter(s => !inManual.has(s));
console.log('Added unit names in victory (' + added.length + '):');
for (const s of added.slice(0, 10)) console.log('  "' + s + '"');
