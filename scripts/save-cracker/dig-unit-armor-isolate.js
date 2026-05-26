// dig-unit-armor-isolate.js
// Cleanest controlled experiment: armor upgrade.
//   before -> after (queue) -> next turn (upgraded)
// The armoury upgrade should bump ONE field at the UNIT level (the armor stat
// slot XX byte) for every unit in the upgraded settlement, with NO soldier-
// array churn (no end-turn between before/after-queue; the upgrade applies the
// turn after). Diff the stat slots + variant-A header to pin armor.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = {
  BEFORE: 'save_before armor upgrade queue.sav',
  AFTER_Q: 'save_after amour upgrade queue.sav',
  UPGRADED: 'save_next turn, armour upgraded..sav',
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
function statSlots(buf, te) {
  let off = -1;
  for (let p = te + 12; p < te + 48; p++) {
    if (buf[p] === 0x01 && buf[p + 1] === 0x00 && buf[p + 2] === 0x40 && buf[p + 3] === 0x00) { off = p; break; }
  }
  const slots = [];
  let p = off;
  while (off >= 0 && buf[p] === 0x01 && buf[p + 1] === 0x00 && buf[p + 2] === 0x40 && buf[p + 3] === 0x00) {
    slots.push(buf[p + 4]);
    p += 14;
    if (slots.length > 12) break;
  }
  return { slotStart: off, slots };
}

// Which region/settlement got the armoury? Find which units changed any slot.
const B = load(SAVES.BEFORE);
const U = load(SAVES.UPGRADED);

function sig(L) {
  const counter = {};
  for (const r of L.recs) {
    const k = `${r.name}|${r.region}`;
    counter[k] = (counter[k] || 0) + 1;
    r._sig = `${k}#${counter[k]}`;
  }
  return new Map(L.recs.map(r => [r._sig, r]));
}
const bm = sig(B);
const um = sig(U);

console.log('=== BEFORE armor-queue  vs  UPGRADED (next turn): stat-slot diffs ===\n');
let changed = 0;
const slotChangePos = {}; // which slot index changed -> count
for (const [s, rb] of bm) {
  const ru = um.get(s);
  if (!ru) continue;
  const teb = regionTermEnd(B.buf, rb);
  const teu = regionTermEnd(U.buf, ru);
  if (teb == null || teu == null) continue;
  const sb = statSlots(B.buf, teb);
  const su = statSlots(U.buf, teu);
  const n = Math.max(sb.slots.length, su.slots.length);
  const diffs = [];
  for (let i = 0; i < n; i++) {
    const a = sb.slots[i], c = su.slots[i];
    if (a !== c) { diffs.push(`slot${i}: ${a}->${c}`); slotChangePos[i] = (slotChangePos[i] || 0) + 1; }
  }
  if (diffs.length) {
    changed++;
    if (changed <= 30) console.log(`  ${s}  ${diffs.join(', ')}`);
  }
}
console.log(`\nTotal units with stat-slot change: ${changed}`);
console.log('Slot-index change frequency:', JSON.stringify(slotChangePos));

// For one changed unit, show the full slot block before/after
for (const [s, rb] of bm) {
  const ru = um.get(s);
  if (!ru) continue;
  const teb = regionTermEnd(B.buf, rb), teu = regionTermEnd(U.buf, ru);
  if (teb == null || teu == null) continue;
  const sb = statSlots(B.buf, teb), su = statSlots(U.buf, teu);
  if (JSON.stringify(sb.slots) !== JSON.stringify(su.slots)) {
    console.log(`\nExample changed unit: ${s}`);
    console.log(`  BEFORE slots: [${sb.slots.join(', ')}]`);
    console.log(`  UPGRADED slots: [${su.slots.join(', ')}]`);
    // Dump full slot region hex
    console.log('  BEFORE slot hex:', Array.from(B.buf.slice(sb.slotStart, sb.slotStart + sb.slots.length * 14)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('  UPGRD  slot hex:', Array.from(U.buf.slice(su.slotStart, su.slotStart + su.slots.length * 14)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    break;
  }
}
