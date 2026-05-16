// dig-head-3.js — Session 107 / 3
// Diff turn-progression saves to classify HEAD growth.
//  - HEAD of ror_t1e vs ror_t2s   (one turn delta)
//  - HEAD of ror_t11s vs ror_t11e  (within-turn deltas)
//  - HEAD of save_mp_before vs save_mp_after (same turn, 1 tile move)
// For each diff: appended N bytes? Modified existing region at offset X? Append a new record?

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function getHead(savFile) {
  const buf = fs.readFileSync(path.join(FIX, savFile));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarb = findFirstBarbarian(buf, REC, REC + player.size);
  return { buf, REC, firstBarb, head: buf.slice(REC + 0xc400, firstBarb) };
}

function lcp(a, b) {
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a[p] === b[p]) p++;
  return p;
}
function lcs(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  while (s < n && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return s;
}

function diffSummary(label, A, B) {
  const headA = A.head, headB = B.head;
  console.log(`\n=== ${label} ===`);
  console.log(`  A.head len = ${headA.length}, B.head len = ${headB.length}, delta = ${headB.length - headA.length}`);
  const cp = lcp(headA, headB);
  const cs = lcs(headA, headB);
  console.log(`  Longest common prefix (matching bytes from start): ${cp}`);
  console.log(`  Longest common suffix (matching bytes from end): ${cs}`);
  console.log(`  Middle region that differs:`);
  console.log(`    A: +0x${cp.toString(16)} .. +0x${(headA.length - cs).toString(16)}  len=${headA.length - cp - cs}`);
  console.log(`    B: +0x${cp.toString(16)} .. +0x${(headB.length - cs).toString(16)}  len=${headB.length - cp - cs}`);
  // Total byte changes
  const n = Math.min(headA.length, headB.length);
  let differBytes = 0;
  for (let i = 0; i < n; i++) if (headA[i] !== headB[i]) differBytes++;
  console.log(`  Byte-wise mismatch over min length (${n}): ${differBytes} bytes differ (${(100*differBytes/n).toFixed(2)}%)`);
  // Identify changed contiguous regions
  if (differBytes === 0 && headA.length === headB.length) {
    console.log(`  HEADS ARE BYTE-IDENTICAL.`);
    return;
  }
  // Walk the diff at the LCP boundary to print context
  console.log(`\n  Bytes around the first diff (offset +0x${cp.toString(16)}):`);
  const ctxStart = Math.max(0, cp - 32);
  console.log(`    A: ${headA.slice(ctxStart, cp).toString('hex')}  | ${headA.slice(cp, cp + 32).toString('hex')}`);
  console.log(`    B: ${headB.slice(ctxStart, cp).toString('hex')}  | ${headB.slice(cp, cp + 32).toString('hex')}`);

  // Identify all contiguous "changed regions" (with up to 8 bytes of matching gap)
  const regions = [];
  let i = 0;
  while (i < n) {
    if (headA[i] === headB[i]) { i++; continue; }
    // scan forward
    let runStart = i;
    while (i < n && headA[i] !== headB[i]) i++;
    let runEnd = i;
    regions.push({ s: runStart, e: runEnd });
  }
  if (headA.length !== headB.length) {
    // append/truncate after n
    regions.push({ s: n, e: Math.max(headA.length, headB.length), isAppend: true });
  }
  // Merge regions with <=16 byte gaps
  const merged = [];
  for (const r of regions) {
    if (merged.length && r.s - merged[merged.length - 1].e <= 16) merged[merged.length - 1].e = r.e;
    else merged.push({ ...r });
  }
  console.log(`  Total mismatch regions (merged with 16 byte gap): ${merged.length}`);
  for (const r of merged.slice(0, 8)) {
    console.log(`    +0x${r.s.toString(16).padStart(5,'0')} .. +0x${r.e.toString(16).padStart(5,'0')}  len=${r.e - r.s}${r.isAppend ? ' (APPEND)':''}`);
  }
}

// Diff 1: save_mp_before -> save_mp_after (1 tile move)
diffSummary('save_mp_before -> save_mp_after (1 tile move, same turn)',
  getHead('save_mp_before.sav'), getHead('save_mp_after.sav'));

// Diff 2: ror_t1e -> ror_t2s (one turn delta)
diffSummary('ror_t1e -> ror_t2s (end T1 -> start T2)',
  getHead('ror_t1e.sav'), getHead('ror_t2s.sav'));

// Diff 3: ror_t11s -> ror_t11e (within-turn)
diffSummary('ror_t11s -> ror_t11e (start T11 -> end T11)',
  getHead('ror_t11s.sav'), getHead('ror_t11e.sav'));

// Diff 4: athens_t22s -> athens_t22mid -> athens_t22e (within-turn progression)
diffSummary('athens_t22s -> athens_t22mid (within-turn)',
  getHead('athens_t22s.sav'), getHead('athens_t22mid.sav'));
diffSummary('athens_t22mid -> athens_t22e (within-turn)',
  getHead('athens_t22mid.sav'), getHead('athens_t22e.sav'));
