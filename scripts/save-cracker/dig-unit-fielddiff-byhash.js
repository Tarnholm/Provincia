// dig-unit-fielddiff-byhash.js
// Join units across saves by the stable u32 unit-UUID (hash at name+2+nameLen+1)
// and diff every UNIT-level field. Report only fields that change, grouped, so
// we can attribute each to the controlled action (armor upgrade / retrain).
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

function load(file) {
  const buf = fs.readFileSync(path.join(BASE_R, file));
  const recs = findUnitRecords(buf);
  for (const r of recs) {
    const nameEnd = r.offset + 2 + Buffer.from(r.name, 'ascii').length + 1;
    r.uuid = buf.readUInt32LE(nameEnd);
    r.seed = buf.readUInt32LE(nameEnd + 4);
    r.te = regionTermEnd(buf, r);
    r.slots = r.te != null ? statSlots(buf, r.te) : null;
  }
  return { buf, recs, byUuid: new Map(recs.map(r => [r.uuid, r])) };
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
    slots.push(buf[p + 4]); p += 14;
    if (slots.length > 12) break;
  }
  return { slotStart: off, slots };
}

function diff(tagA, fileA, tagB, fileB, opts = {}) {
  const A = load(fileA), B = load(fileB);
  console.log(`\n############ ${tagA} -> ${tagB} ############`);
  const changes = { hdr4float: [], hdr8max: [], hdr12cur: [], slots: [], xp: [], wpn: [], arm: [] };
  for (const ra of A.recs) {
    const rb = B.byUuid.get(ra.uuid);
    if (!rb || rb.name !== ra.name) continue;
    if (ra.te == null || rb.te == null) continue;
    const f4a = A.buf.readFloatLE(ra.te + 4), f4b = B.buf.readFloatLE(rb.te + 4);
    const m8a = A.buf.readUInt32LE(ra.te + 8), m8b = B.buf.readUInt32LE(rb.te + 8);
    const c12a = A.buf.readUInt32LE(ra.te + 12), c12b = B.buf.readUInt32LE(rb.te + 12);
    if (Math.abs(f4a - f4b) > 0.001) changes.hdr4float.push({ n: ra.name, reg: ra.region, a: f4a, b: f4b });
    if (m8a !== m8b) changes.hdr8max.push({ n: ra.name, reg: ra.region, a: m8a, b: m8b });
    if (c12a !== c12b) changes.hdr12cur.push({ n: ra.name, reg: ra.region, a: c12a, b: c12b });
    if (ra.slots && rb.slots && JSON.stringify(ra.slots.slots) !== JSON.stringify(rb.slots.slots)) {
      changes.slots.push({ n: ra.name, reg: ra.region, a: ra.slots.slots, b: rb.slots.slots });
    }
    if (ra.xp !== rb.xp) changes.xp.push({ n: ra.name, reg: ra.region, a: ra.xp, b: rb.xp });
    if (ra.weaponUpgrade !== rb.weaponUpgrade) changes.wpn.push({ n: ra.name, reg: ra.region, a: ra.weaponUpgrade, b: rb.weaponUpgrade });
    if (ra.armourUpgrade !== rb.armourUpgrade) changes.arm.push({ n: ra.name, reg: ra.region, a: ra.armourUpgrade, b: rb.armourUpgrade });
  }
  for (const [k, arr] of Object.entries(changes)) {
    console.log(`  ${k}: ${arr.length} units changed`);
    for (const c of arr.slice(0, opts.show || 12)) {
      console.log(`     "${c.n}"@${c.reg}: ${JSON.stringify(c.a)} -> ${JSON.stringify(c.b)}`);
    }
  }
  return { A, B };
}

diff('BEFORE', 'save_before armor upgrade queue.sav', 'UPGRADED', 'save_next turn, armour upgraded..sav', { show: 20 });
diff('AFTERQ', 'save_after amour upgrade queue.sav', 'UPGRADED', 'save_next turn, armour upgraded..sav', { show: 8 });
diff('PRE', 'save_arretium pre retrained..sav', 'QUEUE', 'save_arretium queued retrain.sav', { show: 8 });
diff('QUEUE', 'save_arretium queued retrain.sav', 'T2', 'save_arretium retrained turn 2.sav', { show: 8 });
