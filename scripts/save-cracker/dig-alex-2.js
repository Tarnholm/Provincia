// Multi-action diff of Alex Turn 1 saves. Find:
// 1. Correct turn/year offsets (RIS offsets gave nonsense)
// 2. The fixed-size "command record" that all 5 actions produce (~592 B)
// 3. Common bytes between all 5 actions (shared bookkeeping vs unique per-action)

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVES = [
  ['baseline',        BASE + 'save_17-05-2026   Macedon   Turn 1.sav'],
  ['besige_fort',     BASE + 'save_17-05-2026   Macedon   Turn 1 besige fort.sav'],
  ['move_to_siege',   BASE + 'save_17-05-2026   Macedon   Turn 1 move 1 unit to besige fort army.sav'],
  ['besige_byz',      BASE + 'save_17-05-2026   Macedon   Turn 1 besige Byzantium.sav'],
  ['board_ship',      BASE + 'save_17-05-2026   Macedon   Turn 1 boeard ship.sav'],
  ['disembark_ship',  BASE + 'save_17-05-2026   Macedon   Turn 1 disembarkship.sav'],
];

const bufs = SAVES.map(([t, p]) => [t, fs.readFileSync(p)]);

// Find the year field — for Alex campaign, scan for a known year value
// (Alex campaign starts in 336 BC = year -336)
console.log('=== Year hunt — look for the literal value -336 (= 0xfffffeb0) in headers ===');
for (const [tag, buf] of bufs) {
  for (let p = 0; p < 0x5000; p += 4) {
    const v = buf.readInt32LE(p);
    if (v === -336) {
      console.log('  ' + tag + ': i32@0x' + p.toString(16) + ' = -336 (year)');
      break;
    }
  }
}

// And the turn field — Alex Turn 1 means raw value 0
console.log('\n=== Turn hunt — look for u32 = 0 at a position that becomes 1 next turn ===');
// Without a t2 save, we can't confirm; just probe likely offsets
for (const [tag, buf] of bufs) {
  const candidates = [0x44e3, 0x44e7, 0x3328, 0x3000, 0x4400, 0x4500, 0x4600];
  console.log('  ' + tag + ':');
  for (const off of candidates) {
    if (off + 4 > buf.length) continue;
    console.log('    u32@0x' + off.toString(16) + ' = ' + buf.readUInt32LE(off) + '  i32 = ' + buf.readInt32LE(off));
  }
  break;  // same header for all turn-1 saves
}

// Walking-diff between baseline and each action save
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

const base = bufs[0][1];
console.log('\n=== Per-action diff summary (baseline → action) ===');
console.log('action'.padEnd(20) + '  fileΔ  clusters  topClusterΔ');
const allClusters = {};
for (const [tag, buf] of bufs.slice(1)) {
  const clusters = diff(base, buf);
  const sorted = clusters.slice().sort((a, b) => (b.totalA + b.totalB) - (a.totalA + a.totalB));
  console.log(tag.padEnd(20) +
              '  ' + String(buf.length - base.length).padStart(5) +
              '  ' + String(clusters.length).padStart(8) +
              '  0x' + sorted[0].aStart.toString(16) + ' Δ=' + (sorted[0].totalB - sorted[0].totalA));
  allClusters[tag] = sorted;
}

// Find clusters that appear in ALL 5 actions (common bookkeeping)
console.log('\n=== Clusters present in ALL 5 actions (shared "save was modified" bookkeeping) ===');
// Take the first 50 clusters from each action and find offsets that appear in all
const allTopOffsets = Object.values(allClusters).map(cs => new Set(cs.slice(0, 50).map(c => c.aStart >> 4)));
const common = [...allTopOffsets[0]].filter(x => allTopOffsets.every(s => s.has(x)));
console.log('Common (top 50, aStart >> 4 bucket): ' + common.length + ' offsets');
for (const x of common.slice(0, 20)) {
  console.log('  shared at 0x' + (x << 4).toString(16) + '..');
}

// Top diff per action — dump bytes for the smallest cluster (most isolated change)
console.log('\n=== Smallest meaningful cluster per action (likely the action-specific signature) ===');
function dump(label, buf, off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}
for (const [tag, clusters] of Object.entries(allClusters)) {
  // Find a cluster with totalA + totalB < 100 — the action-specific signature
  const small = clusters.filter(c => c.totalA + c.totalB > 0 && c.totalA + c.totalB < 100).slice(0, 3);
  if (small.length > 0) {
    console.log('\n--- ' + tag + ' small clusters ---');
    for (const c of small) {
      console.log('  cluster @ 0x' + c.aStart.toString(16) + ' lenA=' + c.totalA + ' lenB=' + c.totalB);
      const buf = bufs.find(b => b[0] === tag)[1];
      dump('  A', base, c.aStart - 8, 48);
      dump('  B', buf, c.bStart - 8, 48);
    }
  }
}
