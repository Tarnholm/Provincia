// dig-unit-retrain-diff.js
// Ground-truth diff: locate the SAME unit container across the arretium
// sequence and diff every field (header + stat slots + soldier array).
// The retrain in QUEUE->T2 should change soldier xp/weapon/count for the
// retrained unit only. This isolates which UNIT-level + per-soldier fields move.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = {
  PRE: 'save_arretium pre retrained..sav',
  QUEUE: 'save_arretium queued retrain.sav',
  T2: 'save_arretium retrained turn 2.sav',
  T3: 'save_arretium turn 3.sav',
  T4: 'save_arretium turn 4.sav',
};

function load(file) {
  const buf = fs.readFileSync(path.join(BASE_R, file));
  return { buf, recs: findUnitRecords(buf) };
}

function regionTermEnd(buf, r) {
  const ne = r.offset + 2 + Buffer.from(r.name, 'ascii').length;
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    let ok = true, nm = '';
    for (let j = rs; j < re; j += 2) {
      if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
      nm += String.fromCharCode(buf[j]);
    }
    if (!ok || nm !== r.region) continue;
    return re + 4;
  }
  return null;
}

function findArrayStart(buf, te, count) {
  let off = -1;
  for (let p = te + 12; p < te + 48; p++) {
    if (buf[p] === 0x01 && buf[p + 1] === 0x00 && buf[p + 2] === 0x40 && buf[p + 3] === 0x00) { off = p; break; }
  }
  const slotStart = off;
  let slots = 0;
  while (off >= 0 && buf[off] === 0x01 && buf[off + 1] === 0x00 && buf[off + 2] === 0x40 && buf[off + 3] === 0x00) {
    off += 14; slots++;
    if (slots > 12) break;
  }
  for (let p = off; p < off + 24; p++) {
    if (buf.readUInt16LE(p) === count) return { arrayStart: p + 2, slots, slotStart };
  }
  return { arrayStart: null, slots, slotStart };
}

// Build a stable signature per Etruria unit so we can match across saves even
// as offsets shift. Use (name, indexWithinNameGroup) by file order.
function etruriaUnits(L) {
  const list = L.recs.filter(r => r.region === 'Etruria');
  const counter = {};
  for (const r of list) {
    const k = r.name;
    counter[k] = (counter[k] || 0) + 1;
    r._sig = `${k}#${counter[k]}`;
  }
  return list;
}

const A = load(SAVES.PRE);
const B = load(SAVES.T2);
const ua = etruriaUnits(A);
const ub = etruriaUnits(B);
const bBySig = new Map(ub.map(r => [r._sig, r]));

console.log('=== PRE vs T2 (retrain completed): per-Etruria-unit field diff ===\n');

for (const ra of ua) {
  const rb = bBySig.get(ra._sig);
  if (!rb) { console.log(`  ${ra._sig}: NOT in T2`); continue; }
  const tea = regionTermEnd(A.buf, ra);
  const teb = regionTermEnd(B.buf, rb);
  if (tea == null || teb == null) continue;
  // Compare the variant-A header (te+0 .. te+16) field by field
  const hdrDiffs = [];
  for (let i = 0; i < 16; i += 4) {
    const va = A.buf.readUInt32LE(tea + i);
    const vb = B.buf.readUInt32LE(teb + i);
    if (va !== vb) hdrDiffs.push(`+${i}:${va}->${vb}`);
  }
  // Compare stat slots XX bytes
  const fa = findArrayStart(A.buf, tea, ra.soldiers);
  const fb = findArrayStart(B.buf, teb, rb.soldiers);
  let slotDiffs = [];
  if (fa.slotStart >= 0 && fb.slotStart >= 0) {
    const ns = Math.max(fa.slots, fb.slots);
    for (let s = 0; s < ns; s++) {
      const xa = fa.slotStart >= 0 && s < fa.slots ? A.buf[fa.slotStart + s * 14 + 4] : null;
      const xb = fb.slotStart >= 0 && s < fb.slots ? B.buf[fb.slotStart + s * 14 + 4] : null;
      if (xa !== xb) slotDiffs.push(`slot${s}:${xa}->${xb}`);
    }
    if (fa.slots !== fb.slots) slotDiffs.push(`#slots:${fa.slots}->${fb.slots}`);
  }
  // Compare soldier array byte histograms (which byte positions changed)
  let solChanged = false, solDetail = '';
  if (fa.arrayStart && fb.arrayStart) {
    // Aggregate byte0/byte1/byte2/byte8 distributions
    const aggA = aggArray(A.buf, fa.arrayStart, ra.soldiers);
    const aggB = aggArray(B.buf, fb.arrayStart, rb.soldiers);
    const parts = [];
    for (const pos of [0, 1, 2, 8]) {
      if (JSON.stringify(aggA[pos]) !== JSON.stringify(aggB[pos])) {
        parts.push(`b+${pos}: ${fmt(aggA[pos])} => ${fmt(aggB[pos])}`);
      }
    }
    if (parts.length) { solChanged = true; solDetail = parts.join(' | '); }
  }
  const tag = (hdrDiffs.length || slotDiffs.length || solChanged) ? '*** CHANGED' : 'unchanged';
  console.log(`  ${ra._sig.padEnd(28)} sold ${ra.soldiers}->${rb.soldiers}  ${tag}`);
  if (hdrDiffs.length) console.log(`      hdr: ${hdrDiffs.join(', ')}`);
  if (slotDiffs.length) console.log(`      slots: ${slotDiffs.join(', ')}`);
  if (solChanged) console.log(`      soldiers: ${solDetail}`);
}

function aggArray(buf, start, count) {
  const out = {};
  for (const pos of [0, 1, 2, 8]) out[pos] = {};
  for (let i = 0; i < count; i++) {
    const off = start + i * 9;
    for (const pos of [0, 1, 2, 8]) {
      const v = buf[off + pos];
      out[pos][v] = (out[pos][v] || 0) + 1;
    }
  }
  return out;
}
function fmt(h) {
  return Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([v, c]) => `0x${(+v).toString(16)}×${c}`).join(',');
}
