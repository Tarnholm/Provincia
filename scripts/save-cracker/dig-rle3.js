// dig-rle3.js — Per-record byte/cell diff localization for the
// build-queue change pair (save_1.2 -> save_2.2). All 237 records have
// SOME byte changes, but how big is each? Are they all the same kind of
// "gradient halo shift around faction centroids"? Same question for the
// "ship moved" pair (only rec 0 changed there). Are the 237 changed
// records' diffs SMALL HEADER DIFFS (the -8..0 header bytes) or
// PAYLOAD diffs?

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);

function findAllMagic(buf, hint = 0) {
  const o = [];
  let p = hint;
  while (true) {
    const i = buf.indexOf(MAGIC, p);
    if (i < 0) break;
    o.push(i);
    p = i + 4;
  }
  return o;
}

function loadAllRecs(name) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, name));
  const offs = findAllMagic(buf, 0x1f00000);
  const recs = [];
  for (let i = 0; i < offs.length; i++) {
    const start = offs[i] - 8;
    const next = i + 1 < offs.length ? offs[i + 1] - 8 : null;
    if (next === null) {
      // Last record - find some sensible end. Take to end of last record's payload by reading magic location + payload.
      // We approximate by scanning until we hit a non-RLE byte pattern. For our purposes we'll just skip rec 238 byte-by-byte check.
      recs.push({ start, magicOff: offs[i], end: null, payloadStart: offs[i] + 12 });
    } else {
      recs.push({ start, magicOff: offs[i], end: next, payloadStart: offs[i] + 12 });
    }
  }
  return { buf, recs, size: buf.length };
}

function decodeRle(buf, start, end, W = 1020, H = 700) {
  const mask = new Uint8Array(W * H);
  let cursor = 0;
  let p = start;
  while (p < end - 1 && cursor < mask.length) {
    const v = buf[p];
    const c = buf[p + 1];
    for (let k = 0; k < c && cursor < mask.length; k++) mask[cursor++] = v;
    p += 2;
  }
  return { mask, bytesRead: p - start, filled: cursor };
}

function comparePair(nameA, nameB, label, deepCount = 30) {
  const A = loadAllRecs(nameA);
  const B = loadAllRecs(nameB);
  console.log(`\n=== ${label}: ${nameA} -> ${nameB} ===`);
  const N = Math.min(A.recs.length, B.recs.length);

  // For each record: byte-diff count, header-diff count (-8..magic+12 = pre-payload), payload-diff count
  const summary = [];
  for (let i = 0; i < N - 1; i++) {
    const a = A.recs[i], b = B.recs[i];
    const aLen = a.end - a.start;
    const bLen = b.end - b.start;
    if (aLen !== bLen) {
      summary.push({ rec: i, sizeChanged: true, aLen, bLen });
      continue;
    }
    const baBuf = A.buf.subarray(a.start, a.end);
    const bbBuf = B.buf.subarray(b.start, b.end);
    // Pre-payload (header) is bytes 0..20 within rec (start..magicOff+12).
    // Header length = a.payloadStart - a.start
    const headLen = a.payloadStart - a.start;
    let headerDiff = 0;
    for (let k = 0; k < headLen; k++) if (baBuf[k] !== bbBuf[k]) headerDiff++;
    let payloadDiff = 0;
    for (let k = headLen; k < aLen; k++) if (baBuf[k] !== bbBuf[k]) payloadDiff++;
    summary.push({ rec: i, sizeChanged: false, headerDiff, payloadDiff, len: aLen });
  }

  // Print summary
  const onlyHeader = summary.filter(s => !s.sizeChanged && s.payloadDiff === 0 && s.headerDiff > 0).length;
  const onlyPayload = summary.filter(s => !s.sizeChanged && s.headerDiff === 0 && s.payloadDiff > 0).length;
  const both = summary.filter(s => !s.sizeChanged && s.headerDiff > 0 && s.payloadDiff > 0).length;
  const noDiff = summary.filter(s => !s.sizeChanged && s.headerDiff === 0 && s.payloadDiff === 0).length;
  const sizeChanged = summary.filter(s => s.sizeChanged).length;
  console.log(`  no-diff=${noDiff} only-header=${onlyHeader} only-payload=${onlyPayload} both=${both} size-changed=${sizeChanged}`);

  // Distribution of payload diffs
  const payloadDiffs = summary.filter(s => !s.sizeChanged).map(s => s.payloadDiff);
  payloadDiffs.sort((a, b) => a - b);
  console.log(`  payloadDiff stats: min=${payloadDiffs[0]} p25=${payloadDiffs[Math.floor(payloadDiffs.length / 4)]} med=${payloadDiffs[Math.floor(payloadDiffs.length / 2)]} p75=${payloadDiffs[Math.floor(payloadDiffs.length * 3 / 4)]} max=${payloadDiffs.at(-1)}`);

  // Show records sorted by payloadDiff DESC
  const byPayload = summary.filter(s => !s.sizeChanged).slice().sort((a, b) => b.payloadDiff - a.payloadDiff);
  console.log(`  Top ${deepCount} records by payload-diff (and their header-diff):`);
  for (const s of byPayload.slice(0, deepCount)) {
    console.log(`    rec ${s.rec.toString().padStart(3)}: payloadDiff=${s.payloadDiff} headerDiff=${s.headerDiff} totalLen=${s.len}`);
  }
}

comparePair("save_1.2.sav", "save_2.2.sav", "BUILD_QUEUE (stone_wall in Roma)");
comparePair("save_5.2.sav", "save_6.2.sav", "SHIP MOVED");
comparePair("save_8.2.sav", "save_9.2.sav", "TOGGLE_FOW");
comparePair("save_1.2.sav", "save_4.2.sav", "T1 → T1 after queue toggle");
